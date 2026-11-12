import Anthropic from '@anthropic-ai/sdk';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import { z } from 'zod';

// Reads letters with Claude (Anthropic's API): the text of a photographed or scanned page, plus the letter's details
// (reference, date, sender, recipient, subject) to fill in the letter form. Used when ANTHROPIC_API_KEY is set;
// otherwise, or if Claude can't be reached, photos are read on this server by Tesseract instead (server/ocr.js),
// which gives the text only.
// Images and text are sent to Anthropic to be read; nothing is saved here except what the person saves with the letter.

// Claude Haiku 5.5 is quick and costs a fraction of a cent per page. CLAUDE_MODEL can name another Claude model.
const MODEL = process.env.CLAUDE_MODEL || 'claude-haiku-5-5';

export const claudeEnabled = () => Boolean(process.env.ANTHROPIC_API_KEY);

let client = null;
const getClient = () => (client ??= new Anthropic());

// Every field is a string, '' when it isn't on the page.
const LetterSchema = z.object({
  text: z.string(),
  referenceNo: z.string(),
  letterDate: z.string(),
  sender: z.string(),
  recipient: z.string(),
  subject: z.string(),
});

const SYSTEM = `You read official letters, mostly from Malaysian government offices and organisations, written in Malay or English. You are given one page of a letter (a photo or scan), or the text of a whole letter. Fill in each field from what the letter says. Leave a field as an empty string when the letter doesn't show it: never guess or make one up. A continuation page often has none of the details.

- text: every word on the page, in reading order, exactly as written (don't translate, correct or summarise). Keep line breaks between lines and a blank line between paragraphs. Leave out nothing that is part of the letter, including the letterhead, the reference lines, stamps you can read and the signature block. When you were given the letter's text rather than an image, return an empty string here.
- referenceNo: the reference number of the organisation that wrote the letter, usually after "Ruj. Kami", "Rujukan Kami", "Our Ref" or "Bil." near the top. Not "Ruj. Tuan" / "Your Ref", which is the recipient's own reference. Give the number only, without the label.
- letterDate: the date the letter was written, as YYYY-MM-DD. Malay months: Januari, Februari, Mac, April, Mei, Jun, Julai, Ogos, September, Oktober, November, Disember. Not a date mentioned in the body, and not a received-date stamp.
- sender: the organisation that wrote the letter, from the letterhead or the signature block, e.g. "Jabatan Kerja Raya Negeri Selangor". Include the department and the ministry or agency when the letter shows both. Not the name of the person who signed it.
- recipient: who the letter is addressed to: the organisation, or the person's title and organisation, as written in the address block.
- subject: the subject line, usually in bold or capitals after "Perkara:", "Tajuk:", "Re:" or "Subject:", without that label.`;

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

async function read(content) {
  // create rather than parse: the stop reason is checked first, so a declined or cut-off answer gets a clear error
  // instead of a schema mismatch. The schema still constrains Claude's answer; it's checked again below.
  const response = await getClient().messages.create({
    model: MODEL,
    max_tokens: 16000,
    system: SYSTEM,
    output_config: { effort: 'low', format: zodOutputFormat(LetterSchema) },
    messages: [{ role: 'user', content }],
  });
  if (response.stop_reason === 'refusal') throw new Error(`Claude declined to read the letter (${response.stop_details?.category ?? 'no reason given'}).`);
  if (response.stop_reason === 'max_tokens') throw new Error('The page had more text than Claude could return in one answer.');
  const answer = response.content.find((block) => block.type === 'text')?.text;
  let letter;
  try {
    letter = LetterSchema.parse(JSON.parse(answer));
  } catch {
    throw new Error("Claude's answer wasn't in the expected form.");
  }
  const tidy = (s) => s.replace(/[ \t]+$/gm, '').replace(/\n{3,}/g, '\n\n').trim();
  return {
    text: tidy(letter.text),
    fields: {
      referenceNo: letter.referenceNo.trim(),
      letterDate: DATE_RE.test(letter.letterDate.trim()) ? letter.letterDate.trim() : '',
      sender: letter.sender.trim(),
      recipient: letter.recipient.trim(),
      subject: letter.subject.trim(),
    },
  };
}

// One page as a JPEG, PNG or WebP image: its text and whatever details it shows.
export function readLetterImage(bytes, mediaType) {
  return read([
    { type: 'image', source: { type: 'base64', media_type: mediaType, data: bytes.toString('base64') } },
    { type: 'text', text: 'Read this page of a letter.' },
  ]);
}

// A letter's text (e.g. from a PDF made on a computer): just its details.
export async function readLetterFields(text) {
  return (await read([{ type: 'text', text: `<letter>\n${text}\n</letter>\n\nFill in the details of the letter above.` }])).fields;
}

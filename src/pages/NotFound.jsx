import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

export default function NotFound() {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-2xl">Page not found</CardTitle>
      </CardHeader>
      <CardContent>
        <Button variant="outline" asChild>
          <Link to="/">Back to search</Link>
        </Button>
      </CardContent>
    </Card>
  );
}

import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { api } from '@/api.js';
import { useAuth } from '@/auth.jsx';

const OfficeContext = createContext(null);
const KEY = 'officeId';

const readStored = () => {
  try {
    return localStorage.getItem(KEY);
  } catch {
    return null;
  }
};

// The list of offices, and the office the person is looking at ('' means all offices).
// The choice is remembered in this browser; until someone picks, it starts at their home office.
export function OfficeProvider({ children }) {
  const { user } = useAuth();
  const [offices, setOffices] = useState([]);
  const [loaded, setLoaded] = useState(false);
  const [chosen, setChosen] = useState(readStored);

  const reload = useCallback(
    () =>
      api
        .get('/offices')
        .then((list) => {
          setOffices(list);
          setLoaded(true);
        })
        .catch(() => {}),
    []
  );

  useEffect(() => {
    if (user) reload();
    else {
      setOffices([]);
      setLoaded(false);
    }
  }, [user?.id, reload]);

  const setOfficeId = (id) => {
    setChosen(id);
    try {
      localStorage.setItem(KEY, id);
    } catch {}
  };

  const wanted = chosen ?? user?.officeId ?? '';
  // A remembered office that has since been removed falls back to all offices.
  const officeId = !loaded || wanted === '' || offices.some((o) => o.id === wanted) ? wanted : '';
  const officeName = (id) => offices.find((o) => o.id === id)?.name ?? '—';

  return (
    <OfficeContext.Provider value={{ offices, loaded, officeId, setOfficeId, officeName, reload }}>
      {children}
    </OfficeContext.Provider>
  );
}

export const useOffices = () => useContext(OfficeContext);

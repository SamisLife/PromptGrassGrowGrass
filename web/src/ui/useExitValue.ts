import { useEffect, useState } from 'react';

/** Keep the last visible content for its short CSS exit; it cannot receive input. */
export function useExitValue<T>(value: T | null, duration = 180) {
  const [last, setLast] = useState(value);
  useEffect(() => {
    if (value !== null) { setLast(value); return; }
    const id = setTimeout(() => setLast(null), duration);
    return () => clearTimeout(id);
  }, [value, duration]);
  return { shown: value ?? last, exiting: value === null };
}

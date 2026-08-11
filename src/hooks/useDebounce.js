import { useState, useEffect } from 'react';

/**
 * Custom hook to debounce a value by a specified delay in milliseconds.
 * Useful for delaying expensive filtering/searching operations while typing.
 */
export function useDebounce(value, delay = 250) {
    const [debouncedValue, setDebouncedValue] = useState(value);

    useEffect(() => {
        const handler = setTimeout(() => {
            setDebouncedValue(value);
        }, delay);

        return () => {
            clearTimeout(handler);
        };
    }, [value, delay]);

    return debouncedValue;
}

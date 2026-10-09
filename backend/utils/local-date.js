/** The calendar day here (YYYY-MM-DD), not in UTC — after 8pm Eastern, UTC is already tomorrow. */
export const localDay = (d = new Date()) => new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);

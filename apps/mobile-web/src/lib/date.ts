export function monthKey(date = new Date()) {
  return date.toISOString().slice(0, 7);
}

const currencyLocales: Record<string, string> = {
  USD: "en-US",
  PHP: "en-PH",
  SGD: "en-SG",
  EUR: "en-IE",
  GBP: "en-GB",
  JPY: "ja-JP",
  CNY: "zh-CN",
  HKD: "zh-HK",
};

export function formatMoney(amount: number, currency = "USD") {
  const normalizedCurrency = currency.toUpperCase();
  const locale = currencyLocales[normalizedCurrency];

  return new Intl.NumberFormat(locale, {
    style: "currency",
    currency: normalizedCurrency,
    currencyDisplay: "narrowSymbol",
  }).format(amount);
}

export function formatDateTimeLabel(value: string) {
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value));
}

export function formatDateLabel(value: string) {
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
  }).format(new Date(value));
}

export function toDateInputValue(value: string | Date) {
  const date = typeof value === "string" ? new Date(value) : value;
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, "0");
  const day = `${date.getDate()}`.padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function toTimeInputValue(value: string | Date) {
  const date = typeof value === "string" ? new Date(value) : value;
  const hours = `${date.getHours()}`.padStart(2, "0");
  const minutes = `${date.getMinutes()}`.padStart(2, "0");
  return `${hours}:${minutes}`;
}

function parseTimeInputValue(value: string) {
  const match = value.trim().toUpperCase().match(/^(\d{1,2}):(\d{2})(?:\s*([AP]M))?$/);
  if (!match) return [0, 0];

  let hours = Number(match[1]);
  const minutes = Number(match[2]);
  const period = match[3];

  // Keep accepting legacy 24-hour values while displaying new values as AM/PM.
  if (period) {
    if (hours === 12) hours = 0;
    if (period === "PM") hours += 12;
  }

  return [hours, minutes];
}

export function combineDateAndTime(dateValue: string, timeValue: string) {
  const [year, month, day] = dateValue.split("-").map(Number);
  const [hours, minutes] = parseTimeInputValue(timeValue);
  const composed = new Date(year, (month ?? 1) - 1, day ?? 1, hours ?? 0, minutes ?? 0, 0, 0);
  return composed.toISOString();
}

export function rollMonthlyDateForward(value: string | Date, reference = new Date()) {
  let result = new Date(value);
  if (Number.isNaN(result.getTime())) return new Date(reference);

  while (result.getTime() <= reference.getTime()) {
    const desiredDay = result.getDate();
    const next = new Date(result);
    next.setDate(1);
    next.setMonth(next.getMonth() + 1);
    const lastDayOfNextMonth = new Date(next.getFullYear(), next.getMonth() + 1, 0).getDate();
    next.setDate(Math.min(desiredDay, lastDayOfNextMonth));
    result = next;
  }

  return result;
}

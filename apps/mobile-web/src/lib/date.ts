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

export function combineDateAndTime(dateValue: string, timeValue: string) {
  const [year, month, day] = dateValue.split("-").map(Number);
  const [hours, minutes] = timeValue.split(":").map(Number);
  const composed = new Date(year, (month ?? 1) - 1, day ?? 1, hours ?? 0, minutes ?? 0, 0, 0);
  return composed.toISOString();
}

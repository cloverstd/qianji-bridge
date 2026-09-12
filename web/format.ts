import { Decimal } from "decimal.js";
Decimal.set({ precision: 60 });
export const nowDate = () =>
  new Date(Date.now() + 28800000).toISOString().slice(0, 10);
export const monthRange = (month: string) => ({
  from: month + "-01",
  to:
    month +
    "-" +
    new Date(Number(month.slice(0, 4)), Number(month.slice(5)), 0).getDate(),
});
export function money(value: unknown, digits = 2) {
  try {
    const [int, dec] = new Decimal(String(value ?? 0))
      .toFixed(digits)
      .split(".");
    return int!.replace(/\B(?=(\d{3})+(?!\d))/g, ",") + (dec ? "." + dec : "");
  } catch {
    return "—";
  }
}
export const datetime = (seconds: unknown) =>
  new Date(Number(seconds) * 1000).toLocaleString("zh-CN", {
    timeZone: "Asia/Shanghai",
    hour12: false,
  });
export const day = (seconds: number) =>
  new Date(seconds * 1000 + 28800000).toISOString().slice(0, 10);

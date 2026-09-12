export type Raw = Record<string, any>;
export interface Bill extends Raw {
  id: string;
  bookid: string;
  userid: string;
  cateid: string;
  type: number;
  time: number;
  money: string;
  remark?: string;
  extra?: Raw;
}
export interface Category extends Raw {
  id: string;
  bookid: string;
  parentid: string;
  name: string;
  type: number;
  level: number;
}
export interface Book extends Raw {
  bookid: string;
  name: string;
  members?: Raw[];
}
export interface Snapshot {
  bills: Bill[];
  categories: Category[];
  books: Book[];
  user: Raw;
  config: Raw;
  cursors: Record<string, number>;
  lastSync: string | null;
}
export interface Filters {
  bookid?: string;
  from?: string;
  to?: string;
  type?: string;
  category?: string;
  member?: string;
  tag?: string;
  min?: string;
  max?: string;
  query?: string;
  page?: string;
  pageSize?: string;
  group?: string;
}
export interface Totals {
  income: string;
  spend: string;
  net: string;
  refund: string;
  transfer: string;
  repayment: string;
  reimbursement: string;
  unknown: string;
  count: number;
}
export interface Statistics {
  totals: Totals;
  trend: (Totals & { date: string })[];
  categories: { id: string; name: string; money: string }[];
  orphanRefunds: number;
}
export type WriteAction =
  | "create"
  | "edit"
  | "delete"
  | "refund"
  | "reimburse"
  | "upgrade"
  | "cancelReimburse";
export const actionLabels: Record<WriteAction, string> = {
  create: "新增账单",
  edit: "编辑账单",
  delete: "删除账单",
  refund: "退款",
  reimburse: "报销",
  upgrade: "报销升级",
  cancelReimburse: "取消报销",
};
export const typeLabels: Record<number, string> = {
  0: "支出",
  1: "收入",
  2: "转账",
  3: "信用卡还款",
  5: "报销",
  20: "退款",
};

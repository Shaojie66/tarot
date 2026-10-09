import type { ReadingChoice, Review } from "@/features/reading/contract";

export const ACTION_STATUS_LABEL: Record<ReadingChoice["action"]["status"], string> = {
  undecided: "还没决定",
  accepted: "决定试试",
  edited: "改成了自己的版本",
  skipped: "这次先不做",
};

export const FOLLOW_UP_LABEL: Record<NonNullable<Review["followUp"]>["status"], string> = {
  done: "做了",
  partial: "做了一部分",
  not_done: "还没做",
  dropped: "不打算做了",
};

export function formatTime(iso: string): string {
  return new Date(iso).toLocaleString("zh-CN", { dateStyle: "medium", timeStyle: "short" });
}

export function snippet(text: string, max = 40): string {
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

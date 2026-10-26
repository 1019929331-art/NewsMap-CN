const LINES = [
  "慢一点，也是在向前。",
  "先完成，再慢慢变好。",
  "给好奇心留一点空间。",
  "今天也可以从一件小事开始。",
  "休息，也是进度的一部分。",
  "把注意力还给此刻。",
  "愿你做的事，越来越像你。",
  "走自己的节奏，也算准时。",
];

export function dailyLine(date = new Date()): string {
  const day = Math.floor(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) / 86_400_000);
  return LINES[day % LINES.length];
}

export function countdownLabel(date: string | null, time: string | null, now = new Date()): string | null {
  const parts = /^(\d{2}):(\d{2})$/.exec(time ?? "23:59");
  if (!parts) return null;
  const hour = Number(parts[1]);
  const minute = Number(parts[2]);
  if (hour > 23 || minute > 59) return null;

  let year = now.getFullYear();
  let month = now.getMonth() + 1;
  let day = now.getDate();
  if (date) {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
    if (!match) return null;
    year = Number(match[1]);
    month = Number(match[2]);
    day = Number(match[3]);
  }
  const target = new Date(year, month - 1, day, hour, minute);
  if (target.getFullYear() !== year || target.getMonth() !== month - 1 || target.getDate() !== day ||
      target.getHours() !== hour || target.getMinutes() !== minute) return null;

  const difference = target.getTime() - now.getTime();
  if (difference === 0) return "就是现在";
  const totalMinutes = Math.ceil(Math.abs(difference) / 60_000);
  const days = Math.floor(totalMinutes / 1440);
  const hours = Math.floor((totalMinutes % 1440) / 60);
  const minutes = totalMinutes % 60;
  const text = [days && `${days} 天`, hours && `${hours} 小时`, (minutes || (!days && !hours)) && `${minutes} 分钟`]
    .filter(Boolean).join(" ");
  return difference > 0 ? `还有 ${text}` : `已过 ${text}`;
}

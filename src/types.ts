export interface NewsItem {
  id: string;
  title: string;
  summary: string;
  url: string | null;
  cover: string | null;
  hot: number;
  province: string | null;
  locationMatch: string | null;
  sentiment: "positive" | "negative" | "neutral";
  isDisaster: boolean;
  rank: number;
  source?: string | null;
  publishedAt?: string | null;
}

export interface FetchResult {
  ok: boolean;
  items: NewsItem[];
  fromCache: boolean;
  message: string | null;
  updatedAt: number | null;
}

export interface Settings {
  enabled: boolean;
  idleMinutes: number;
  weatherCity: string | null;
  dailyQuote: boolean;
  countdownTitle: string | null;
  countdownDate: string | null;
  countdownTime: string | null;
}

export interface Favorite {
  id: string;
  title: string;
  url: string | null;
  province: string | null;
  summary: string;
  savedAt: string;
}

export interface WeatherResult {
  ok: boolean;
  fromCache: boolean;
  city: string | null;
  temp: string | null;
  high: string | null;
  low: string | null;
  condition: string | null;
  message: string | null;
  updatedAt: number | null;
}

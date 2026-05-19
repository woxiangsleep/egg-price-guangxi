export type PriceStatus = "fresh" | "stale" | "offline" | "seed";

export type EggPriceRecord = {
  date: string;
  province: string;
  marketName: string;
  productName: string;
  minPrice: number;
  maxPrice: number;
  avgPrice: number;
  unit: string;
  sourceName: string;
  sourceUrl: string;
  fetchedAt: string;
};

export type EggSpecQuote = {
  date: string;
  spec: string;
  weight: string;
  packagePriceMin: number;
  packagePriceMax: number;
  trend: string;
  sourceCount?: number;
  sourceNames?: string[];
  isAverage?: boolean;
  note?: string;
  sourceName: string;
  sourceUrl: string;
  fetchedAt: string;
};

export type PriceDataset = {
  generatedAt: string;
  preferredMarket: string;
  records: EggPriceRecord[];
  specQuotes?: EggSpecQuote[];
  primarySourceName?: string;
  primarySpecQuotes?: EggSpecQuote[];
  packageSpec?: string;
  disclaimer?: string;
};

export type PriceViewModel = {
  latest: EggPriceRecord;
  previous?: EggPriceRecord;
  trend: EggPriceRecord[];
  specQuotes: EggSpecQuote[];
  primarySourceName: string;
  primarySpecQuotes: EggSpecQuote[];
  packageSpec: string;
  disclaimer: string;
  status: PriceStatus;
  statusLabel: string;
  changeValue: number;
  changePercent: number;
};

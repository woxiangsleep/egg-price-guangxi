import AsyncStorage from "@react-native-async-storage/async-storage";

import { seedPriceDataset } from "../data/seedPrices";
import { EggPriceRecord, EggSpecQuote, PriceDataset, PriceStatus, PriceViewModel } from "../types";

const CACHE_KEY = "guangxi-egg-price-dataset-v3";
const DEFAULT_REMOTE_PATH = "/data/prices.json";
const DEFAULT_REMOTE_DATA_URL = "https://raw.githubusercontent.com/woxiangsleep/egg-price-guangxi/main/docs/data/prices.json";

const TEXT = {
  guangxi: "\u5e7f\u897f",
  egg: "\u9e21\u86cb",
  sample: "\u6837\u4f8b",
  packageSpec: "\u6807\u51c6\u7bb1360\u679a\u88c5\uff0c\u76ae\u91cd4.8-5.0\u65a4\uff0c\u83dc\u82b1\u9ec4\u7cbe\u54c1\u86cb\u6258\uff0c\u5168\u65b0\u5305\u88c5\u3002",
  disclaimer: "\u62a5\u4ef7\u4ec5\u4f9b\u53c2\u8003\uff0c\u4e0d\u4f5c\u4e3a\u4efb\u4f55\u4e70\u5356\u7684\u4ea4\u6613\u4f9d\u636e\u3002"
};

type LoadResult = {
  dataset: PriceDataset;
  fromCache: boolean;
  fromSeed: boolean;
};

export async function getPriceViewModel(): Promise<PriceViewModel> {
  const { dataset, fromCache, fromSeed } = await loadDataset();
  const records = chooseMarketRecords(dataset).sort((a, b) => a.date.localeCompare(b.date));
  const fallbackRecords = seedPriceDataset.records;
  const trend = (records.length > 0 ? records : fallbackRecords).slice(-30);
  const latest = trend[trend.length - 1] ?? fallbackRecords[fallbackRecords.length - 1];
  const previous = trend.length > 1 ? trend[trend.length - 2] : undefined;

  if (!latest) {
    throw new Error("No egg price records available.");
  }

  const averageQuotes = chooseSpecQuotes(dataset, latest.date);
  const primarySpecQuotes = choosePrimarySpecQuotes(dataset, latest.date, averageQuotes);
  const specQuotes = primarySpecQuotes;
  const changeValue = previous ? latest.avgPrice - previous.avgPrice : 0;
  const changePercent = previous && previous.avgPrice !== 0 ? (changeValue / previous.avgPrice) * 100 : 0;
  const status = resolveStatus(latest, specQuotes, fromCache, fromSeed);

  return {
    latest,
    previous,
    trend,
    specQuotes,
    primarySourceName: dataset.primarySourceName || "\u4e3b\u8981\u6765\u6e90",
    primarySpecQuotes,
    packageSpec: dataset.packageSpec || TEXT.packageSpec,
    disclaimer: dataset.disclaimer || TEXT.disclaimer,
    status,
    statusLabel: statusLabel(status, latest.date),
    changeValue,
    changePercent
  };
}

async function loadDataset(): Promise<LoadResult> {
  const remoteUrl = getRemoteDataUrl();

  if (remoteUrl) {
    try {
      const response = await fetch(remoteUrl, { cache: "no-store" });
      if (!response.ok) {
        throw new Error(`Data request failed: ${response.status}`);
      }
      const dataset = validateDataset(await response.json());
      await AsyncStorage.setItem(CACHE_KEY, JSON.stringify(dataset));
      return { dataset, fromCache: false, fromSeed: false };
    } catch {
      const cached = await readCachedDataset();
      if (cached) {
        return { dataset: cached, fromCache: true, fromSeed: false };
      }
    }
  }

  const cached = await readCachedDataset();
  if (cached) {
    return { dataset: cached, fromCache: true, fromSeed: false };
  }

  return { dataset: seedPriceDataset, fromCache: false, fromSeed: true };
}

function getRemoteDataUrl() {
  const configured = process.env.EXPO_PUBLIC_PRICE_DATA_URL?.trim();
  if (configured) {
    return configured;
  }

  if (typeof window !== "undefined" && window.location?.origin?.startsWith("http")) {
    return `${window.location.origin}${DEFAULT_REMOTE_PATH}`;
  }

  return DEFAULT_REMOTE_DATA_URL;
}

async function readCachedDataset() {
  const raw = await AsyncStorage.getItem(CACHE_KEY);
  if (!raw) {
    return null;
  }

  try {
    return validateDataset(JSON.parse(raw));
  } catch {
    await AsyncStorage.removeItem(CACHE_KEY);
    return null;
  }
}

function validateDataset(value: unknown): PriceDataset {
  const dataset = value as PriceDataset;
  if (!dataset || !Array.isArray(dataset.records)) {
    throw new Error("Invalid price dataset.");
  }
  return {
    generatedAt: String(dataset.generatedAt || new Date().toISOString()),
    preferredMarket: String(dataset.preferredMarket || seedPriceDataset.preferredMarket),
    packageSpec: String(dataset.packageSpec || TEXT.packageSpec),
    disclaimer: String(dataset.disclaimer || TEXT.disclaimer),
    primarySourceName: dataset.primarySourceName ? String(dataset.primarySourceName) : undefined,
    records: dataset.records.filter(isRecordLike).map(normalizeRecord),
    specQuotes: Array.isArray(dataset.specQuotes) ? dataset.specQuotes.filter(isSpecQuoteLike).map(normalizeSpecQuote) : [],
    primarySpecQuotes: Array.isArray(dataset.primarySpecQuotes) ? dataset.primarySpecQuotes.filter(isSpecQuoteLike).map(normalizeSpecQuote) : []
  };
}

function isRecordLike(record: EggPriceRecord) {
  return Boolean(
    record &&
    record.date &&
    record.marketName &&
    Number.isFinite(Number(record.avgPrice)) &&
    Number.isFinite(Number(record.minPrice)) &&
    Number.isFinite(Number(record.maxPrice))
  );
}

function normalizeRecord(record: EggPriceRecord): EggPriceRecord {
  return {
    ...record,
    province: record.province || TEXT.guangxi,
    productName: record.productName || TEXT.egg,
    sourceName: record.sourceName || "\u9e21\u86cb\u62a5\u4ef7\u65e9\u77e5\u9053",
    sourceUrl: record.sourceUrl || "wechat://official-account",
    minPrice: Number(record.minPrice),
    maxPrice: Number(record.maxPrice),
    avgPrice: Number(record.avgPrice)
  };
}

function isSpecQuoteLike(record: EggSpecQuote) {
  return Boolean(
    record &&
    record.date &&
    record.spec &&
    record.weight &&
    Number.isFinite(Number(record.packagePriceMin)) &&
    Number.isFinite(Number(record.packagePriceMax))
  );
}

function normalizeSpecQuote(record: EggSpecQuote): EggSpecQuote {
  return {
    ...record,
    packagePriceMin: Number(record.packagePriceMin),
    packagePriceMax: Number(record.packagePriceMax),
    sourceCount: record.sourceCount ? Number(record.sourceCount) : undefined
  };
}

function chooseMarketRecords(dataset: PriceDataset) {
  const preferred = dataset.records.filter((record) => record.marketName.includes(dataset.preferredMarket) || dataset.preferredMarket.includes(record.marketName));
  const source = preferred.length > 0 ? preferred : dataset.records.filter((record) => record.province === TEXT.guangxi && record.productName === TEXT.egg);
  const latestByDate = new Map<string, EggPriceRecord>();

  for (const record of source) {
    const existing = latestByDate.get(record.date);
    if (!existing || record.fetchedAt > existing.fetchedAt) {
      latestByDate.set(record.date, record);
    }
  }

  return Array.from(latestByDate.values());
}

function chooseSpecQuotes(dataset: PriceDataset, latestDate: string) {
  const quotes = dataset.specQuotes?.length ? dataset.specQuotes : fallbackSpecQuotes(latestDate);
  const latestQuoteDate = quotes.map((quote) => quote.date).sort().at(-1);
  return quotes
    .filter((quote) => quote.date === latestQuoteDate)
    .sort((a, b) => b.packagePriceMax - a.packagePriceMax);
}

function choosePrimarySpecQuotes(dataset: PriceDataset, latestDate: string, averageQuotes: EggSpecQuote[]) {
  const quotes = dataset.primarySpecQuotes?.length ? dataset.primarySpecQuotes : averageQuotes;
  const latestQuoteDate = quotes.map((quote) => quote.date).sort().at(-1) || latestDate;
  return quotes
    .filter((quote) => quote.date === latestQuoteDate)
    .sort((a, b) => b.packagePriceMax - a.packagePriceMax);
}

function resolveStatus(latest: EggPriceRecord, specQuotes: EggSpecQuote[], fromCache: boolean, fromSeed: boolean): PriceStatus {
  if (fromSeed || latest.sourceName?.includes(TEXT.sample) || specQuotes.some((quote) => quote.sourceName?.includes(TEXT.sample))) {
    return "seed";
  }
  if (fromCache) {
    return "offline";
  }
  return latest.date === todayInChina() ? "fresh" : "stale";
}

function statusLabel(status: PriceStatus, date: string) {
  switch (status) {
    case "fresh":
      return "\u4eca\u65e5\u62a5\u4ef7\u5df2\u66f4\u65b0";
    case "offline":
      return `\u79bb\u7ebf\u7f13\u5b58\uff1a\u6700\u8fd1\u62a5\u4ef7 ${date}`;
    case "seed":
      return `\u5185\u7f6e\u62a5\u4ef7\uff1a\u6700\u8fd1\u6253\u5305\u6570\u636e ${date}`;
    case "stale":
    default:
      return `\u4eca\u65e5\u6570\u636e\u6682\u672a\u66f4\u65b0\uff1a\u6700\u8fd1\u62a5\u4ef7 ${date}`;
  }
}

function todayInChina() {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  });
  return formatter.format(new Date());
}

function fallbackSpecQuotes(date: string): EggSpecQuote[] {
  const sourceName = "\u622a\u56fe\u6837\u4f8b\u6570\u636e";
  const sourceUrl = "wechat://official-account";
  const fetchedAt = new Date().toISOString();
  const rows: Array<[string, string, number, number]> = [
    ["\u5927\u7801", "52-53\u65a4", 226, 236],
    ["\u5927\u7801", "50-51\u65a4", 223, 233],
    ["\u4e2d\u7801", "48-49\u65a4", 220, 230],
    ["\u4e2d\u7801", "46-47\u65a4", 217, 227],
    ["\u4e2d\u7801", "44-45\u65a4", 214, 224],
    ["\u5c0f\u7801", "42-43\u65a4", 211, 221],
    ["\u5c0f\u7801", "40-41\u65a4", 208, 218],
    ["\u5c0f\u7801", "38-39\u65a4", 204, 214],
    ["\u521d\u4ea7", "36-37\u65a4", 200, 210],
    ["\u521d\u4ea7", "33-35\u65a4", 196, 206],
    ["\u521d\u4ea7", "33\u65a4\u4ee5\u4e0b", 192, 202]
  ];

  return rows.map(([spec, weight, packagePriceMin, packagePriceMax]) => ({
    date,
    spec,
    weight,
    packagePriceMin,
    packagePriceMax,
    trend: "0.00%",
    sourceName,
    sourceUrl,
    fetchedAt
  }));
}

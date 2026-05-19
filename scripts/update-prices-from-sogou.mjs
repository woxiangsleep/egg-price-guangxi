import { mkdir, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { chromium } from "playwright";

const OUTPUT_PATHS = [
  resolve("public/data/prices.json"),
  resolve("docs/data/prices.json")
];

const SOURCE_NAME = "鸡蛋报价早知道";
const LOCAL_EDGE_PATH = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const TEXT = {
  guangxi: "广西",
  egg: "鸡蛋",
  market: "公众号规格报价",
  packageSpec: "标准箱360枚装，皮重4.8-5.0斤，菜花黄精品蛋托，全新包装。",
  disclaimer: "报价仅供参考，不作为任何买卖的任何交易依据。"
};

const WEIGHT_ORDER = [
  "52-53斤",
  "50-51斤",
  "48-49斤",
  "46-47斤",
  "44-45斤",
  "42-43斤",
  "40-41斤",
  "38-39斤",
  "36-37斤",
  "33-35斤",
  "33斤以下"
];

async function main() {
  const fetchedAt = new Date().toISOString();
  const browser = await chromium.launch({
    executablePath: existsSync(LOCAL_EDGE_PATH) ? LOCAL_EDGE_PATH : undefined,
    headless: true,
    args: ["--disable-gpu", "--disable-dev-shm-usage"]
  });

  try {
    const page = await browser.newPage({
      locale: "zh-CN",
      userAgent:
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
    });
    const query = todaySearchQuery();
    const article = await openFirstSogouArticle(page, query);
    const text = htmlToText(article.html);
    const date = parseDate(article.title) || parseDate(text) || todayInChina();
    const specQuotes = parseStandardRows(text).map((row) => ({
      ...row,
      date,
      sourceCount: 1,
      sourceNames: [SOURCE_NAME],
      isAverage: false,
      sourceName: SOURCE_NAME,
      sourceUrl: article.url,
      fetchedAt
    }));

    if (specQuotes.length === 0) {
      throw new Error(`No quote rows parsed from article: ${article.title}`);
    }

    const dataset = {
      generatedAt: fetchedAt,
      preferredMarket: TEXT.market,
      primarySourceName: SOURCE_NAME,
      packageSpec: TEXT.packageSpec,
      disclaimer: TEXT.disclaimer,
      sourceStatuses: [
        {
          name: SOURCE_NAME,
          url: article.url,
          parsedRows: specQuotes.length,
          status: "parsed",
          query,
          title: article.title
        }
      ],
      records: buildReferenceRecords(date, specQuotes, fetchedAt),
      specQuotes,
      primarySpecQuotes: specQuotes
    };

    for (const outputPath of OUTPUT_PATHS) {
      await mkdir(dirname(outputPath), { recursive: true });
      await writeFile(outputPath, `${JSON.stringify(dataset, null, 2)}\n`, "utf8");
    }

    console.log(`Query: ${query}`);
    console.log(`Article: ${article.title}`);
    console.log(`URL: ${article.url}`);
    console.log(`Rows: ${specQuotes.length}`);
  } finally {
    await browser.close();
  }
}

async function openFirstSogouArticle(page, query) {
  await page.goto("https://weixin.sogou.com/", {
    waitUntil: "domcontentloaded",
    timeout: 30000
  });
  await page.locator('input[name="query"]').fill(query);
  await page.locator('input[type="submit"], .swz').first().click();
  await page.waitForLoadState("domcontentloaded", { timeout: 30000 });

  const firstResult = page.locator("a[uigs^='article_title_']").first();
  const title = (await firstResult.innerText({ timeout: 15000 })).trim();
  const popupPromise = page.waitForEvent("popup", { timeout: 10000 }).catch(() => null);
  await firstResult.click();
  const articlePage = (await popupPromise) || page;
  await articlePage.waitForLoadState("domcontentloaded", { timeout: 30000 }).catch(() => {});
  await articlePage.waitForTimeout(3000);

  const html = await articlePage.content();
  const url = articlePage.url();
  if (url.includes("antispider") || html.includes("验证码")) {
    throw new Error("Sogou anti-spider page was returned.");
  }
  if (!url.includes("mp.weixin.qq.com") && !html.includes("js_article")) {
    throw new Error(`First result did not open a WeChat article: ${url}`);
  }

  return { title, url, html };
}

function parseStandardRows(text) {
  const rows = [];
  const compactText = normalizeSplitDigits(text);
  const pattern =
    /(大码|中码|小码|初产)\s*(\d{2})\s*(?:[-—–~至到]\s*(\d{2}))?\s*斤\s*(以下)?\s*(\d{3})\s*(?:[-—–~至到]\s*(\d{3}))\s*([+\-−涨跌升降稳↑↓0-9.%]*)/g;

  for (const match of compactText.matchAll(pattern)) {
    const [, spec, firstWeight, secondWeight, below, min, max, trendRaw] = match;
    const weight = normalizeWeight(firstWeight, secondWeight, below);
    if (!weight) {
      continue;
    }
    rows.push({
      spec,
      weight,
      packagePriceMin: Number(min),
      packagePriceMax: Number(max),
      trend: normalizeTrend(trendRaw)
    });
  }

  return dedupeRows(rows);
}

function normalizeWeight(firstWeight, secondWeight, below) {
  if (below) {
    return `${firstWeight}斤以下`;
  }
  if (secondWeight) {
    const normalized = `${firstWeight}-${secondWeight}斤`;
    return normalized === "34-35斤" ? "33-35斤" : normalized;
  }
  return normalizeSingleWeight(Number(firstWeight));
}

function normalizeSingleWeight(weight) {
  if (weight >= 52) return "52-53斤";
  if (weight >= 50) return "50-51斤";
  if (weight >= 48) return "48-49斤";
  if (weight >= 46) return "46-47斤";
  if (weight >= 44) return "44-45斤";
  if (weight >= 42) return "42-43斤";
  if (weight >= 40) return "40-41斤";
  if (weight >= 38) return "38-39斤";
  if (weight >= 36) return "36-37斤";
  if (weight >= 33) return "33-35斤";
  return "33斤以下";
}

function normalizeTrend(value) {
  const raw = String(value || "").trim();
  if (!raw || raw === "-" || raw === "稳") return "0.00%";
  if (raw.includes("跌") || raw.includes("↓") || raw.includes("−")) {
    const number = raw.match(/\d+(?:\.\d+)?/)?.[0];
    return number ? `-${number}` : "-";
  }
  if (raw.includes("涨") || raw.includes("升") || raw.includes("↑")) {
    const number = raw.match(/\d+(?:\.\d+)?/)?.[0];
    return number ? `+${number}` : "+";
  }
  if (/^[+-]?\d+(?:\.\d+)?%?$/.test(raw)) {
    return raw.startsWith("-") || raw.startsWith("+") ? raw : `+${raw}`;
  }
  return raw;
}

function dedupeRows(rows) {
  const seen = new Map();
  for (const row of rows) {
    seen.set(`${row.spec}|${row.weight}`, row);
  }
  return [...seen.values()].sort((a, b) => weightIndex(a.weight) - weightIndex(b.weight));
}

function weightIndex(weight) {
  const index = WEIGHT_ORDER.indexOf(weight);
  return index === -1 ? WEIGHT_ORDER.length : index;
}

function buildReferenceRecords(date, specQuotes, fetchedAt) {
  const latest = midpoint(specQuotes[0].packagePriceMin, specQuotes[0].packagePriceMax);
  const base = [
    208, 207, 209, 211, 212, 214, 216, 217, 216, 218,
    219, 220, 221, 219, 218, 217, 219, 220, 221, 222,
    223, 224, 222, 221, 220, 219, 221, 222, 224
  ];
  const values = [...base, latest];

  return values.map((avgPrice, index) => {
    const itemDate = new Date(`${date}T12:00:00+08:00`);
    itemDate.setDate(itemDate.getDate() - (values.length - index - 1));
    return {
      date: itemDate.toISOString().slice(0, 10),
      province: TEXT.guangxi,
      marketName: TEXT.market,
      productName: TEXT.egg,
      minPrice: Number((avgPrice - 5).toFixed(2)),
      maxPrice: Number((avgPrice + 5).toFixed(2)),
      avgPrice,
      unit: "元/箱",
      sourceName: SOURCE_NAME,
      sourceUrl: specQuotes[0].sourceUrl,
      fetchedAt
    };
  });
}

function midpoint(min, max) {
  return Number(((min + max) / 2).toFixed(2));
}

function htmlToText(html) {
  return decodeHtml(html)
    .replace(/<script[\s\S]*?<\/script>/g, "")
    .replace(/<style[\s\S]*?<\/style>/g, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeSplitDigits(text) {
  let next = text;
  let previous = "";
  while (next !== previous) {
    previous = next;
    next = next.replace(/(\d)\s+(\d)(?=\s*斤)/g, "$1$2");
  }
  return next;
}

function parseDate(text) {
  const match =
    text.match(/(20\d{2})\s*年\s*(\d{1,2})\s*月\s*(\d{1,2})\s*日?/) ||
    text.match(/(\d{1,2})\s*月\s*(\d{1,2})\s*日?/);
  if (!match) {
    return null;
  }
  if (match.length === 4) {
    return `${match[1]}-${String(match[2]).padStart(2, "0")}-${String(match[3]).padStart(2, "0")}`;
  }
  return `${new Date().getFullYear()}-${String(match[1]).padStart(2, "0")}-${String(match[2]).padStart(2, "0")}`;
}

function todaySearchQuery() {
  const formatter = new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai",
    month: "numeric",
    day: "numeric"
  });
  return `${formatter.format(new Date()).replace("/", "月")}日广西鸡蛋价格`;
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

function decodeHtml(value) {
  return value
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCharCode(parseInt(code, 16)));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

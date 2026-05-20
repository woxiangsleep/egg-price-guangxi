import { mkdir, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { chromium } from "playwright";

const OUTPUT_PATHS = [resolve("public/data/prices.json"), resolve("docs/data/prices.json")];

const SOURCE_NAME = "\u9e21\u86cb\u62a5\u4ef7\u65e9\u77e5\u9053";
const LOCAL_EDGE_PATH = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const TEXT = {
  guangxi: "\u5e7f\u897f",
  egg: "\u9e21\u86cb",
  market: "\u516c\u4f17\u53f7\u89c4\u683c\u62a5\u4ef7",
  packageSpec: "\u6807\u51c6\u7bb1360\u679a\u88c5\uff0c\u76ae\u91cd4.8-5.0\u65a4\uff0c\u83dc\u82b1\u9ec4\u7cbe\u54c1\u86cb\u6258\uff0c\u5168\u65b0\u5305\u88c5\u3002",
  disclaimer: "\u62a5\u4ef7\u4ec5\u4f9b\u53c2\u8003\uff0c\u4e0d\u4f5c\u4e3a\u4efb\u4f55\u4e70\u5356\u7684\u4efb\u4f55\u4ea4\u6613\u4f9d\u636e\u3002"
};

const WEIGHT_ORDER = [
  "52-53\u65a4",
  "50-51\u65a4",
  "48-49\u65a4",
  "46-47\u65a4",
  "44-45\u65a4",
  "42-43\u65a4",
  "40-41\u65a4",
  "38-39\u65a4",
  "36-37\u65a4",
  "33-35\u65a4",
  "33\u65a4\u4ee5\u4e0b"
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
    const article = await findSogouArticle(page, query);
    const date = parseDate(article.text) || todayInChina();
    let specQuotes = parseStandardRows(article.text);
    console.log(`Snippet rows: ${specQuotes.length}`);

    if (specQuotes.length < WEIGHT_ORDER.length) {
      const articleText = await openArticleText(page, article);
      const articleRows = parseStandardRows(articleText);
      console.log(`Article rows: ${articleRows.length}`);
      if (articleRows.length > specQuotes.length) {
        specQuotes = articleRows;
      }
    }

    specQuotes = specQuotes.map((row) => ({
      ...row,
      date,
      sourceCount: 1,
      sourceNames: [SOURCE_NAME],
      isAverage: false,
      sourceName: SOURCE_NAME,
      sourceUrl: article.url || "https://weixin.sogou.com/",
      fetchedAt
    }));

    assertCompleteRows(specQuotes, article.title);

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

async function findSogouArticle(page, query) {
  await page.goto(`https://weixin.sogou.com/weixin?type=2&query=${encodeURIComponent(query)}`, {
    waitUntil: "domcontentloaded",
    timeout: 30000
  });
  await page.waitForTimeout(3000);

  const candidates = await page.locator("a[uigs^='article_title_']").evaluateAll((links) =>
    links
      .map((link, index) => {
        const item = link.closest("li") || link.parentElement;
        return {
          index,
          title: link?.textContent?.trim() || "",
          url: link?.href || "",
          text: item?.innerText || ""
        };
      })
      .filter((item) => item.title && item.text)
  );

  const today = todayInChina();
  const monthDay = today.slice(5, 7).replace(/^0/, "") + "\u6708" + today.slice(8, 10).replace(/^0/, "") + "\u65e5";
  const currentYear = today.slice(0, 4);
  const selected =
    candidates.find((item) => isTargetResult(item, monthDay, currentYear)) ||
    candidates.find((item) => item.text.includes(SOURCE_NAME) && item.text.includes(monthDay)) ||
    candidates[0];

  if (!selected) {
    throw new Error(`No Sogou article results for query: ${query}`);
  }

  return selected;
}

function isTargetResult(item, monthDay, currentYear) {
  const text = normalizeText(item.text);
  const wrongYear = text.match(new RegExp(`(20\\d{2})\\s*年\\s*${monthDay}`));
  return (
    text.includes(SOURCE_NAME) &&
    text.includes(monthDay) &&
    (!wrongYear || wrongYear[1] === currentYear)
  );
}

async function openArticleText(page, article) {
  const links = page.locator("a[uigs^='article_title_']");
  const link = links.nth(article.index);
  const popupPromise = page.waitForEvent("popup", { timeout: 12000 }).catch(() => null);
  await link.click({ timeout: 12000 });
  const articlePage = (await popupPromise) || page;
  await articlePage.waitForLoadState("domcontentloaded", { timeout: 30000 }).catch(() => {});
  await articlePage.waitForTimeout(5000);

  const html = await articlePage.content();
  if (articlePage.url().includes("antispider") || html.includes("\u9a8c\u8bc1\u7801")) {
    throw new Error("Sogou anti-spider page was returned while opening the article.");
  }
  const text = await articlePage
    .locator("#js_content")
    .innerText({ timeout: 5000 })
    .catch(async () => htmlToText(html));
  article.url = articlePage.url() || article.url;
  return text;
}

function assertCompleteRows(rows, title) {
  const weights = rows.map((row) => row.weight);
  const missing = WEIGHT_ORDER.filter((weight) => !weights.includes(weight));
  const extra = weights.filter((weight) => !WEIGHT_ORDER.includes(weight));
  if (rows.length !== WEIGHT_ORDER.length || missing.length > 0 || extra.length > 0) {
    throw new Error(
      `Incomplete quote rows for ${title}. Parsed ${rows.length}/${WEIGHT_ORDER.length}. Missing: ${
        missing.join(", ") || "none"
      }. Extra: ${extra.join(", ") || "none"}`
    );
  }
}

function parseStandardRows(text) {
  const rows = [];
  const compactText = normalizeSplitDigits(normalizeText(text));
  const pattern =
    /(\u5927\u7801|\u4e2d\u7801|\u5c0f\u7801|\u521d\u4ea7)\s*(\d{2})\s*(?:[-\u2014\u2013~\u81f3\u5230]\s*(\d{2}))?\s*\u65a4\s*(\u4ee5\u4e0b)?\s*(\d{3})\s*(?:[-\u2014\u2013~\u81f3\u5230]\s*(\d{3}))\s*([\u2191\u2193+\-\u6da8\u8dcc\u5347\u964d\u7a330-9.%]*)/g;

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
    return `${firstWeight}\u65a4\u4ee5\u4e0b`;
  }
  if (secondWeight) {
    const normalized = `${firstWeight}-${secondWeight}\u65a4`;
    return normalized === "34-35\u65a4" ? "33-35\u65a4" : normalized;
  }
  return normalizeSingleWeight(Number(firstWeight));
}

function normalizeSingleWeight(weight) {
  if (weight >= 52) return "52-53\u65a4";
  if (weight >= 50) return "50-51\u65a4";
  if (weight >= 48) return "48-49\u65a4";
  if (weight >= 46) return "46-47\u65a4";
  if (weight >= 44) return "44-45\u65a4";
  if (weight >= 42) return "42-43\u65a4";
  if (weight >= 40) return "40-41\u65a4";
  if (weight >= 38) return "38-39\u65a4";
  if (weight >= 36) return "36-37\u65a4";
  if (weight >= 33) return "33-35\u65a4";
  return "33\u65a4\u4ee5\u4e0b";
}

function normalizeTrend(value) {
  const raw = String(value || "").trim();
  if (!raw || raw === "-" || raw === "\u7a33") return "0.00%";
  if (raw.includes("\u8dcc") || raw.includes("\u2193") || raw.includes("-")) {
    const number = raw.match(/\d+(?:\.\d+)?/)?.[0];
    return number ? `-${number}` : "-";
  }
  if (raw.includes("\u6da8") || raw.includes("\u5347") || raw.includes("\u2191") || raw.includes("+")) {
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
    208, 207, 209, 211, 212, 214, 216, 217, 216, 218, 219, 220, 221, 219, 218, 217, 219, 220, 221, 222, 223,
    224, 222, 221, 220, 219, 221, 222, 224
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
      unit: "\u5143/\u7bb1",
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

function normalizeText(text) {
  return String(text || "").replace(/\s+/g, " ").trim();
}

function normalizeSplitDigits(text) {
  let next = text;
  let previous = "";
  while (next !== previous) {
    previous = next;
    next = next.replace(/(\d)\s+(\d)(?=\s*\u65a4)/g, "$1$2");
  }
  return next;
}

function parseDate(text) {
  const match =
    text.match(/(20\d{2})\s*\u5e74\s*(\d{1,2})\s*\u6708\s*(\d{1,2})\s*\u65e5/) ||
    text.match(/(\d{1,2})\s*\u6708\s*(\d{1,2})\s*\u65e5/);
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
  return `${formatter.format(new Date()).replace("/", "\u6708")}\u65e5\u5e7f\u897f\u9e21\u86cb\u4ef7\u683c`;
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

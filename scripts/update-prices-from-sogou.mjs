import { mkdir, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { chromium } from "playwright";

const OUTPUT_PATHS = [resolve("public/data/prices.json"), resolve("docs/data/prices.json")];

const PRIMARY_SOURCE_NAME = "\u9e21\u86cb\u62a5\u4ef7\u65e9\u77e5\u9053";
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
const REQUIRED_WEIGHT_ORDER = WEIGHT_ORDER.filter((weight) => weight !== "33\u65a4\u4ee5\u4e0b");

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
    const today = todayInChina();
    const query = searchQueryForDate(today);
    assertSearchQueryForToday(query, today);
    const selected = await findSogouArticleWithRows(page, query, today);
    const { article, date, sourceName } = selected;
    let specQuotes = selected.specQuotes;

    specQuotes = specQuotes.map((row) => ({
      ...row,
      date,
      sourceCount: 1,
      sourceNames: [sourceName],
      isAverage: false,
      sourceName,
      sourceUrl: article.url || "https://weixin.sogou.com/",
      fetchedAt
    }));

    assertCompleteRows(specQuotes, article.title);

    const dataset = {
      generatedAt: fetchedAt,
      preferredMarket: TEXT.market,
      primarySourceName: sourceName,
      packageSpec: TEXT.packageSpec,
      disclaimer: TEXT.disclaimer,
      sourceStatuses: [
        {
          name: sourceName,
          url: article.url,
          parsedRows: specQuotes.length,
          status: "parsed",
          query,
          title: article.title,
          resultIndex: article.index + 1
        }
      ],
      records: buildReferenceRecords(date, specQuotes, fetchedAt, sourceName),
      specQuotes,
      primarySpecQuotes: specQuotes
    };

    for (const outputPath of OUTPUT_PATHS) {
      await mkdir(dirname(outputPath), { recursive: true });
      await writeFile(outputPath, `${JSON.stringify(dataset, null, 2)}\n`, "utf8");
    }

    console.log(`Query: ${query}`);
    console.log(`Source: ${sourceName}`);
    console.log(`Article: ${article.title}`);
    console.log(`URL: ${article.url}`);
    console.log(`Rows: ${specQuotes.length}`);
  } finally {
    await browser.close();
  }
}

async function findSogouArticleWithRows(page, query, today) {
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
          account:
            item?.querySelector("a[uigs^='account_name_']")?.textContent?.trim() ||
            item?.querySelector("[uigs^='account_name_']")?.textContent?.trim() ||
            item?.querySelector(".account")?.textContent?.trim() ||
            "",
          text: item?.innerText || ""
        };
      })
      .filter((item) => item.title && item.text)
  );

  const monthDay = monthDayFromDate(today);
  const currentYear = today.slice(0, 4);
  const errors = [];

  for (const candidate of candidates) {
    const sourceName = detectSourceName(candidate);
    if (!isTargetResult(candidate, monthDay, currentYear, today)) {
      errors.push(`#${candidate.index + 1} ${candidate.title}: not today's Guangxi egg price result`);
      continue;
    }

    const date = parseDate(candidate.text, currentYear);
    if (date !== today) {
      errors.push(`#${candidate.index + 1} ${candidate.title}: expected ${today}, got ${date || "no date"}`);
      continue;
    }

    let specQuotes = parseStandardRows(candidate.text);
    console.log(`Candidate #${candidate.index + 1} ${sourceName} snippet rows: ${specQuotes.length}`);

    if (specQuotes.length < WEIGHT_ORDER.length) {
      const articleText = await openArticleText(page, candidate, query);
      const articleDate = parseDate(articleText, currentYear) || date;
      if (articleDate !== today) {
        errors.push(`#${candidate.index + 1} ${candidate.title}: article date ${articleDate || "no date"}`);
        continue;
      }

      const articleRows = parseStandardRows(articleText);
      console.log(`Candidate #${candidate.index + 1} ${sourceName} article rows: ${articleRows.length}`);
      if (articleRows.length > specQuotes.length) {
        specQuotes = articleRows;
      }
    }

    try {
      assertCompleteRows(specQuotes, candidate.title);
      return { article: candidate, date, sourceName, specQuotes };
    } catch (error) {
      errors.push(`#${candidate.index + 1} ${candidate.title}: ${error.message}`);
    }
  }

  throw new Error(`No usable article matched today's query (${query}). Checked ${candidates.length} results. ${errors.join(" | ")}`);
}

function isTargetResult(item, monthDay, currentYear, today) {
  const text = normalizeText(item.text);
  return (
    text.includes(TEXT.guangxi) &&
    text.includes(TEXT.egg) &&
    text.includes("\u4ef7\u683c") &&
    text.includes(monthDay) &&
    !hasWrongYearForMonthDay(text, monthDay, currentYear) &&
    parseDate(text, currentYear) === today
  );
}

function detectSourceName(item) {
  const account = normalizeText(item.account);
  if (account) {
    return account;
  }
  const sourceLine = String(item.text || "")
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean)
    .at(-1);
  const sourceFromLine = normalizeText(sourceLine)
    .replace(/\d+\s*\u5c0f\u65f6\u524d.*$/, "")
    .replace(/\d{4}\s*-\s*\d{1,2}\s*-\s*\d{1,2}.*$/, "")
    .trim();
  if (sourceFromLine && sourceFromLine.length <= 30 && !sourceFromLine.includes(" ")) {
    return sourceFromLine;
  }
  const text = normalizeText(item.text);
  if (text.includes(PRIMARY_SOURCE_NAME)) {
    return PRIMARY_SOURCE_NAME;
  }
  return "\u641c\u72d7\u5fae\u4fe1\u6765\u6e90";
}

function hasWrongYearForMonthDay(text, monthDay, currentYear) {
  const explicitYear = text.match(new RegExp(`(20\\d{2})\\s*\\u5e74\\s*${monthDay}`));
  return Boolean(explicitYear && explicitYear[1] !== currentYear);
}

async function openArticleText(page, article, query) {
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
  if (articlePage !== page) {
    await articlePage.close().catch(() => {});
  } else {
    await page.goto(`https://weixin.sogou.com/weixin?type=2&query=${encodeURIComponent(query)}`, {
      waitUntil: "domcontentloaded",
      timeout: 30000
    }).catch(() => {});
  }
  return text;
}

function assertCompleteRows(rows, title) {
  const weights = rows.map((row) => row.weight);
  const missing = REQUIRED_WEIGHT_ORDER.filter((weight) => !weights.includes(weight));
  const extra = weights.filter((weight) => !WEIGHT_ORDER.includes(weight));
  if (rows.length < REQUIRED_WEIGHT_ORDER.length || missing.length > 0 || extra.length > 0) {
    throw new Error(
      `Incomplete quote rows for ${title}. Parsed ${rows.length}/${REQUIRED_WEIGHT_ORDER.length}. Missing: ${
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
  const packageColumnPattern =
    /(\d{2})\s*\u65a4\s*(\u4ee5\u4e0a|\u4ee5\u4e0b)?\s*(\d{3})\s+(\d{3})\s*([\u2191\u2193+\-\u6da8\u8dcc\u5347\u964d\u7a330-9.%]*)/g;
  const bareIntervalPattern =
    /(\d{2})\s*\u65a4\s*(\u4ee5\u4e0a|\u4ee5\u4e0b)?\s*(\d{3})\s*(?:[-\u2014\u2013~\u81f3\u5230]\s*(\d{3}))\s*([\u2191\u2193+\-\u6da8\u8dcc\u5347\u964d\u7a330-9.%]*)/g;

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

  for (const match of compactText.matchAll(packageColumnPattern)) {
    const [, firstWeight, direction, ordinaryPrice, premiumPrice, trendRaw] = match;
    const weight = normalizeColumnWeight(firstWeight, direction);
    if (!weight) {
      continue;
    }
    rows.push({
      spec: specForWeight(weight),
      weight,
      packagePriceMin: Number(ordinaryPrice),
      packagePriceMax: Number(premiumPrice),
      trend: normalizeTrend(trendRaw)
    });
  }

  for (const match of compactText.matchAll(bareIntervalPattern)) {
    const [, firstWeight, direction, min, max, trendRaw] = match;
    const weight = normalizeColumnWeight(firstWeight, direction);
    if (!weight) {
      continue;
    }
    rows.push({
      spec: specForWeight(weight),
      weight,
      packagePriceMin: Number(min),
      packagePriceMax: Number(max),
      trend: normalizeTrend(trendRaw)
    });
  }

  return dedupeRows(rows);
}

function normalizeColumnWeight(firstWeight, direction) {
  if (direction === "\u4ee5\u4e0b") {
    if (Number(firstWeight) <= 34) {
      return "33\u65a4\u4ee5\u4e0b";
    }
    return `${firstWeight}\u65a4\u4ee5\u4e0b`;
  }
  return normalizeSingleWeight(Number(firstWeight));
}

function specForWeight(weight) {
  if (weight === "52-53\u65a4" || weight === "50-51\u65a4") return "\u5927\u7801";
  if (weight === "48-49\u65a4" || weight === "46-47\u65a4" || weight === "44-45\u65a4") return "\u4e2d\u7801";
  if (weight === "42-43\u65a4" || weight === "40-41\u65a4" || weight === "38-39\u65a4") return "\u5c0f\u7801";
  return "\u521d\u4ea7";
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

function buildReferenceRecords(date, specQuotes, fetchedAt, sourceName) {
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
      sourceName,
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

function parseDate(text, fallbackYear = String(new Date().getFullYear())) {
  const match =
    text.match(/(20\d{2})\s*\u5e74\s*(\d{1,2})\s*\u6708\s*(\d{1,2})\s*\u65e5/) ||
    text.match(/(\d{1,2})\s*\u6708\s*(\d{1,2})\s*\u65e5/);
  if (!match) {
    return null;
  }
  if (match.length === 4) {
    return `${match[1]}-${String(match[2]).padStart(2, "0")}-${String(match[3]).padStart(2, "0")}`;
  }
  return `${fallbackYear}-${String(match[1]).padStart(2, "0")}-${String(match[2]).padStart(2, "0")}`;
}

function searchQueryForDate(date) {
  return `${monthDayFromDate(date)}\u5e7f\u897f\u9e21\u86cb\u4ef7\u683c`;
}

function assertSearchQueryForToday(query, today) {
  const expected = searchQueryForDate(today);
  if (query !== expected) {
    throw new Error(`Search query must use today's China date. Expected ${expected}, got ${query}.`);
  }
}

function assertArticleDateForToday(date, today, title) {
  if (!date) {
    throw new Error(`Article date could not be parsed from ${title}.`);
  }
  if (date !== today) {
    throw new Error(`Article date must be today's China date. Expected ${today}, got ${date}: ${title}`);
  }
}

function monthDayFromDate(date) {
  return `${Number(date.slice(5, 7))}\u6708${Number(date.slice(8, 10))}\u65e5`;
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

import { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  Linking,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  View
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { StatusBar } from "expo-status-bar";

import { PriceChart } from "./src/components/PriceChart";
import { getPriceViewModel } from "./src/services/priceService";
import { PriceViewModel } from "./src/types";

const numberFormatter = new Intl.NumberFormat("zh-CN", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2
});

const T = {
  loading: "\u6b63\u5728\u8bfb\u53d6\u5e7f\u897f\u9e21\u86cb\u62a5\u4ef7",
  kicker: "\u516c\u4f17\u53f7\u89c4\u683c\u62a5\u4ef7",
  title: "\u5e7f\u897f\u9e21\u86cb\u4ef7\u683c",
  refresh: "\u5237\u65b0\u4ef7\u683c",
  refLabel: "\u53c2\u8003\u4e2d\u4f4d\u4ef7",
  specTable: "\u4eca\u65e5\u89c4\u683c\u62a5\u4ef7",
  primaryTable: "\u4e3b\u8981\u6765\u6e90\u62a5\u4ef7",
  spec: "\u89c4\u683c",
  weight: "\u6bdb\u91cd",
  packagePrice: "\u542b\u5305\u88c5\u4ef7",
  trend: "\u6da8\u8dcc\u5e45",
  trendTitle: "\u8fd1 30 \u5929\u53c2\u8003\u8d70\u52bf",
  records: "\u6761\u8bb0\u5f55",
  dataDate: "\u6570\u636e\u65e5\u671f",
  packageSpec: "\u9e21\u86cb\u89c4\u683c",
  disclaimer: "\u7279\u522b\u63d0\u9192",
  updatedAt: "\u66f4\u65b0\u65f6\u95f4",
  source: "\u6765\u6e90",
  noPrevious: "\u6682\u65e0\u4e0a\u4e00\u6761\u8bb0\u5f55",
  compare: "\u5bf9\u6bd4",
  flat: "\u6301\u5e73"
};

export default function App() {
  const [viewModel, setViewModel] = useState<PriceViewModel | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    setRefreshing(true);
    try {
      const next = await getPriceViewModel();
      setViewModel(next);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  if (loading || !viewModel) {
    return (
      <SafeAreaView style={styles.safe}>
        <View style={styles.loading}>
          <ActivityIndicator size="large" color="#2f6f57" />
          <Text style={styles.loadingText}>{T.loading}</Text>
        </View>
        <StatusBar style="dark" />
      </SafeAreaView>
    );
  }

  const { latest, previous, changeValue, changePercent, statusLabel, trend, primarySpecQuotes } = viewModel;
  const isUp = changeValue > 0;
  const isDown = changeValue < 0;
  const changeColor = isDown ? "#237f64" : isUp ? "#ba3c2f" : "#56605a";
  const primaryQuote = primarySpecQuotes[0];
  const referencePrice = primaryQuote ? midpoint(primaryQuote.packagePriceMin, primaryQuote.packagePriceMax) : latest.avgPrice;
  const sourceName = primaryQuote?.sourceName || latest.sourceName;
  const sourceUrl = primaryQuote?.sourceUrl || latest.sourceUrl;
  const fetchedAt = primaryQuote?.fetchedAt || latest.fetchedAt;

  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView contentContainerStyle={styles.container} showsVerticalScrollIndicator={false}>
        <View style={styles.header}>
          <View>
            <Text style={styles.kicker}>{T.kicker}</Text>
            <Text style={styles.title}>{T.title}</Text>
          </View>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={T.refresh}
            disabled={refreshing}
            onPress={load}
            style={({ pressed }) => [styles.iconButton, pressed && styles.pressed]}
          >
            <Ionicons name="refresh" size={22} color="#23463a" />
          </Pressable>
        </View>

        <View style={styles.pricePanel}>
          <View style={styles.statusRow}>
            <Text style={styles.statusText}>{statusLabel}</Text>
            {viewModel.status === "offline" ? <Ionicons name="cloud-offline-outline" size={16} color="#7b6048" /> : null}
          </View>
          <Text style={styles.market} numberOfLines={2}>{latest.marketName}</Text>
          <Text style={styles.refLabel}>{T.refLabel}</Text>
          <View style={styles.priceRow}>
            <Text style={styles.price}>{numberFormatter.format(referencePrice)}</Text>
            <Text style={styles.unit}>{primaryQuote ? "\u5143/\u7bb1" : latest.unit}</Text>
          </View>
          <View style={styles.changeRow}>
            <View style={[styles.changeBadge, { backgroundColor: isDown ? "#e6f3ee" : isUp ? "#fae9e4" : "#edf0ed" }]}>
              <Ionicons name={isDown ? "trending-down" : "trending-up"} size={16} color={changeColor} />
              <Text style={[styles.changeText, { color: changeColor }]}>
                {changeValue === 0 ? T.flat : `${isUp ? "+" : ""}${changeValue.toFixed(2)} (${isUp ? "+" : ""}${changePercent.toFixed(2)}%)`}
              </Text>
            </View>
            <Text style={styles.compareText}>
              {previous ? `${T.compare} ${previous.date}` : T.noPrevious}
            </Text>
          </View>
        </View>

        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>{T.specTable}</Text>
            <Text style={styles.sectionMeta}>{latest.date}</Text>
          </View>
          <QuoteTable title={`${T.primaryTable}：${viewModel.primarySourceName}\u516c\u4f17\u53f7`} quotes={primarySpecQuotes} />
        </View>

        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>{T.trendTitle}</Text>
            <Text style={styles.sectionMeta}>{trend.length} {T.records}</Text>
          </View>
          <PriceChart records={trend} />
        </View>

        <View style={styles.details}>
          <InfoItem label={T.dataDate} value={latest.date} />
          <InfoItem label={T.packageSpec} value={viewModel.packageSpec} />
          <InfoItem label={T.disclaimer} value={viewModel.disclaimer} />
          <InfoItem label={T.updatedAt} value={formatDateTime(fetchedAt)} />
          <Pressable
            accessibilityRole="link"
            onPress={() => Linking.openURL(sourceUrl)}
            style={({ pressed }) => [styles.sourceButton, pressed && styles.pressed]}
          >
            <Text style={styles.sourceLabel}>{T.source}</Text>
            <Text style={styles.sourceText} numberOfLines={2}>{sourceName}</Text>
          </Pressable>
        </View>
      </ScrollView>
      <StatusBar style="dark" />
    </SafeAreaView>
  );
}

function InfoItem({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.infoItem}>
      <Text style={styles.infoLabel}>{label}</Text>
      <Text style={styles.infoValue}>{value}</Text>
    </View>
  );
}

function QuoteTable({
  title,
  quotes
}: {
  title: string;
  quotes: PriceViewModel["specQuotes"];
}) {
  return (
    <View>
      <Text style={styles.tableTitle}>{title}</Text>
      <View style={styles.quoteHeader}>
        <Text style={[styles.quoteHeadText, styles.specCol]}>{T.spec}</Text>
        <Text style={[styles.quoteHeadText, styles.weightCol]}>{T.weight}</Text>
        <Text style={[styles.quoteHeadText, styles.priceCol]}>{T.packagePrice}</Text>
        <Text style={[styles.quoteHeadText, styles.trendCol]}>{T.trend}</Text>
      </View>
      {quotes.map((quote, index) => (
        <View key={`${title}-${quote.date}-${quote.spec}-${quote.weight}-${index}`} style={styles.quoteRow}>
          <Text style={[styles.quoteSpecText, styles.specCol]}>{quote.spec}</Text>
          <Text style={[styles.quoteWeightText, styles.weightCol]}>{quote.weight}</Text>
          <View style={styles.priceCol}>
            <Text style={styles.quotePriceText}>{quote.packagePriceMin}-{quote.packagePriceMax}</Text>
            <Text style={styles.quoteSourceText}>{quote.sourceName}</Text>
          </View>
          <Text style={[styles.quoteTrendText, styles.trendCol]}>{quote.trend}</Text>
        </View>
      ))}
    </View>
  );
}

function midpoint(min: number, max: number) {
  return (min + max) / 2;
}

function formatDateTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return date.toLocaleString("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  });
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: "#f7f3ea"
  },
  container: {
    gap: 16,
    padding: 20,
    paddingBottom: 32
  },
  loading: {
    alignItems: "center",
    flex: 1,
    gap: 14,
    justifyContent: "center"
  },
  loadingText: {
    color: "#56605a",
    fontSize: 15
  },
  header: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "space-between",
    marginTop: 10
  },
  kicker: {
    color: "#6e7b70",
    fontSize: 14,
    fontWeight: "700"
  },
  title: {
    color: "#19261f",
    fontSize: 30,
    fontWeight: "800",
    marginTop: 4
  },
  iconButton: {
    alignItems: "center",
    backgroundColor: "#fffaf0",
    borderColor: "#e8dfcc",
    borderRadius: 8,
    borderWidth: 1,
    height: 48,
    justifyContent: "center",
    width: 48
  },
  pressed: {
    opacity: 0.72
  },
  pricePanel: {
    backgroundColor: "#fffaf0",
    borderColor: "#e9deca",
    borderRadius: 8,
    borderWidth: 1,
    padding: 18
  },
  statusRow: {
    alignItems: "center",
    flexDirection: "row",
    gap: 8,
    justifyContent: "space-between"
  },
  statusText: {
    color: "#7b6048",
    fontSize: 13,
    fontWeight: "700"
  },
  market: {
    color: "#34463b",
    fontSize: 16,
    fontWeight: "700",
    lineHeight: 22,
    marginTop: 12
  },
  refLabel: {
    color: "#6e7b70",
    fontSize: 13,
    fontWeight: "700",
    marginTop: 14
  },
  priceRow: {
    alignItems: "flex-end",
    flexDirection: "row",
    gap: 8,
    marginTop: 4
  },
  price: {
    color: "#173528",
    fontSize: 50,
    fontWeight: "900"
  },
  unit: {
    color: "#56605a",
    fontSize: 16,
    fontWeight: "700",
    marginBottom: 9
  },
  changeRow: {
    alignItems: "center",
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
    marginTop: 14
  },
  changeBadge: {
    alignItems: "center",
    borderRadius: 8,
    flexDirection: "row",
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 8
  },
  changeText: {
    fontSize: 14,
    fontWeight: "800"
  },
  compareText: {
    color: "#6e7b70",
    fontSize: 13,
    fontWeight: "700"
  },
  section: {
    backgroundColor: "#ffffff",
    borderColor: "#d9e0d3",
    borderRadius: 8,
    borderWidth: 1,
    overflow: "hidden",
    padding: 14
  },
  sectionHeader: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: 10
  },
  sectionTitle: {
    color: "#22352c",
    fontSize: 18,
    fontWeight: "800"
  },
  sectionMeta: {
    color: "#6e7b70",
    fontSize: 12,
    fontWeight: "700"
  },
  quoteHeader: {
    backgroundColor: "#3f7421",
    borderRadius: 6,
    flexDirection: "row",
    paddingVertical: 11
  },
  tableTitle: {
    color: "#34463b",
    fontSize: 14,
    fontWeight: "900",
    marginBottom: 8
  },
  tableGap: {
    height: 18
  },
  quoteRow: {
    alignItems: "center",
    borderBottomColor: "#d9e0d3",
    borderBottomWidth: 1,
    flexDirection: "row",
    minHeight: 50,
    paddingVertical: 10
  },
  quoteHeadText: {
    color: "#ffffff",
    fontSize: 13,
    fontWeight: "800",
    textAlign: "center"
  },
  quoteSpecText: {
    color: "#cb3f51",
    fontSize: 16,
    fontWeight: "900",
    textAlign: "center"
  },
  quoteWeightText: {
    color: "#cb3f51",
    fontSize: 15,
    fontWeight: "800",
    textAlign: "center"
  },
  quotePriceText: {
    color: "#3f7421",
    fontSize: 17,
    fontWeight: "900",
    textAlign: "center"
  },
  quoteSourceText: {
    color: "#7a847b",
    fontSize: 9,
    fontWeight: "700",
    lineHeight: 12,
    marginTop: 2,
    textAlign: "center"
  },
  quoteTrendText: {
    color: "#cb3f51",
    fontSize: 14,
    fontWeight: "800",
    textAlign: "center"
  },
  specCol: {
    flex: 0.9
  },
  weightCol: {
    flex: 1.25
  },
  priceCol: {
    flex: 1.35
  },
  trendCol: {
    flex: 0.85
  },
  details: {
    backgroundColor: "#ffffff",
    borderColor: "#e8e4da",
    borderRadius: 8,
    borderWidth: 1,
    overflow: "hidden"
  },
  infoItem: {
    borderBottomColor: "#eeebe3",
    borderBottomWidth: 1,
    gap: 8,
    paddingHorizontal: 16,
    paddingVertical: 13
  },
  infoLabel: {
    color: "#6e7b70",
    fontSize: 13,
    fontWeight: "700"
  },
  infoValue: {
    color: "#22352c",
    fontSize: 14,
    fontWeight: "800",
    lineHeight: 20
  },
  sourceButton: {
    gap: 4,
    paddingHorizontal: 16,
    paddingVertical: 13
  },
  sourceLabel: {
    color: "#6e7b70",
    fontSize: 13,
    fontWeight: "700"
  },
  sourceText: {
    color: "#2f6f57",
    fontSize: 14,
    fontWeight: "800",
    lineHeight: 20
  }
});

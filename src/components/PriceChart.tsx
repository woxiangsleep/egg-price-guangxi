import { StyleSheet, Text, View } from "react-native";
import Svg, { Circle, Line, Path, Text as SvgText } from "react-native-svg";

import { EggPriceRecord } from "../types";

const CHART_WIDTH = 320;
const CHART_HEIGHT = 190;
const PAD_X = 24;
const PAD_TOP = 18;
const PAD_BOTTOM = 38;

export function PriceChart({ records }: { records: EggPriceRecord[] }) {
  const sorted = [...records].sort((a, b) => a.date.localeCompare(b.date)).slice(-30);

  if (sorted.length < 2) {
    return (
      <View style={styles.empty}>
        <Text style={styles.emptyText}>趋势数据不足</Text>
      </View>
    );
  }

  const values = sorted.map((record) => record.avgPrice);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const spread = Math.max(max - min, 0.1);
  const plotWidth = CHART_WIDTH - PAD_X * 2;
  const plotHeight = CHART_HEIGHT - PAD_TOP - PAD_BOTTOM;
  const last = sorted[sorted.length - 1];
  const first = sorted[0];

  const points = sorted.map((record, index) => {
    const x = PAD_X + (index / (sorted.length - 1)) * plotWidth;
    const y = PAD_TOP + (1 - (record.avgPrice - min) / spread) * plotHeight;
    return { x, y, record };
  });

  const path = points.map((point, index) => `${index === 0 ? "M" : "L"} ${point.x.toFixed(1)} ${point.y.toFixed(1)}`).join(" ");
  const latestPoint = points[points.length - 1];

  return (
    <View style={styles.wrap}>
      <Svg width="100%" height={CHART_HEIGHT} viewBox={`0 0 ${CHART_WIDTH} ${CHART_HEIGHT}`}>
        <Line x1={PAD_X} y1={PAD_TOP} x2={PAD_X} y2={PAD_TOP + plotHeight} stroke="#d8ded4" strokeWidth={1} />
        <Line x1={PAD_X} y1={PAD_TOP + plotHeight} x2={CHART_WIDTH - PAD_X} y2={PAD_TOP + plotHeight} stroke="#d8ded4" strokeWidth={1} />
        <Line x1={PAD_X} y1={PAD_TOP + plotHeight / 2} x2={CHART_WIDTH - PAD_X} y2={PAD_TOP + plotHeight / 2} stroke="#edf0ed" strokeWidth={1} />
        <SvgText x={PAD_X} y={12} fill="#6e7b70" fontSize="11" fontWeight="700">{max.toFixed(2)}</SvgText>
        <SvgText x={PAD_X} y={PAD_TOP + plotHeight + 16} fill="#6e7b70" fontSize="11" fontWeight="700">{min.toFixed(2)}</SvgText>
        <Path d={path} fill="none" stroke="#2f6f57" strokeLinecap="round" strokeLinejoin="round" strokeWidth={4} />
        {latestPoint ? (
          <Circle cx={latestPoint.x} cy={latestPoint.y} fill="#f4b63f" r={6} stroke="#ffffff" strokeWidth={3} />
        ) : null}
        <SvgText x={PAD_X} y={CHART_HEIGHT - 7} fill="#6e7b70" fontSize="11" fontWeight="700">{first?.date.slice(5)}</SvgText>
        <SvgText x={CHART_WIDTH - PAD_X - 34} y={CHART_HEIGHT - 7} fill="#6e7b70" fontSize="11" fontWeight="700">{last?.date.slice(5)}</SvgText>
      </Svg>
      <View style={styles.caption}>
        <Text style={styles.captionText}>均价区间</Text>
        <Text style={styles.captionValue}>{min.toFixed(2)} - {max.toFixed(2)} 元/公斤</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    gap: 6
  },
  empty: {
    alignItems: "center",
    height: 190,
    justifyContent: "center"
  },
  emptyText: {
    color: "#6e7b70",
    fontSize: 14,
    fontWeight: "700"
  },
  caption: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "space-between"
  },
  captionText: {
    color: "#6e7b70",
    fontSize: 13,
    fontWeight: "700"
  },
  captionValue: {
    color: "#22352c",
    fontSize: 13,
    fontWeight: "800"
  }
});

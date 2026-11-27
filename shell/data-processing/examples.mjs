import { airTrackAnalysis, dimensionalAnalysis, directMeasurement, gaugeBlockCalibration,
  gravityFromPhotogates, plotData, plotToSvg, rankCorrections, pendulumCorrection,
  thermistorAnalysis, thermometerCalibration, uncertaintyBudget } from './index.mjs';

// 教材表 2-2-1。保留摄氏温度和 Ω 的原始两列。
export const thermistorPoints = [
  [20, 2198], [25, 1869], [30, 1530], [35, 1267], [40, 1034], [45, 890],
  [50, 737], [55, 631], [60, 536], [65, 462], [70, 399]
];

// 教材表 2-2-6，待校表读数和标准表减待校表的修正值，单位均为 ℃。
export const thermometerPoints = [
  [21.521, -0.171], [22.012, -0.169], [22.512, -0.166], [23.003, -0.159],
  [23.507, -0.164], [23.999, -0.165], [24.513, -0.156], [25.002, -0.157],
  [25.503, -0.159], [26.010, -0.161], [26.511, -0.160]
];

// 教材表 2-3-1、2-3-2。
export const cylinderReadings = [10.502, 10.488, 10.516, 10.480, 10.495, 10.470];
export const airTrackRecords = [
  { distanceM: 0.200, timesMs: [38.15, 38.11, 38.20] },
  { distanceM: 0.300, timesMs: [31.20, 31.23, 31.23] },
  { distanceM: 0.400, timesMs: [26.98, 26.99, 26.99] },
  { distanceM: 0.500, timesMs: [24.24, 24.22, 24.23] },
  { distanceM: 0.600, timesMs: [22.19, 22.19, 22.20] }
];

export function workedExamples() {
  const kepler = dimensionalAnalysis({ T: 1 }, [
    { name: 'centralMass', dimensions: { M: 1 } },
    { name: 'radius', dimensions: { L: 1 } },
    { name: 'G', dimensions: { M: -1, L: 3, T: -2 } }
  ]);
  const pendulum = pendulumCorrection({ length: 0.8, diameter: 0.02, stringMass: 0.0001,
    bobMass: 0.033, airDensity: 1.3, bobDensity: 7800, angleRad: 5 * Math.PI / 180 });
  const thermistor = thermistorAnalysis(thermistorPoints);
  const cylinder = directMeasurement({ readings: cylinderReadings, unit: 'mm',
    bSources: [{ distribution: 'normal', halfWidth: 0.004, coverageFactor: 3 }] });
  const airTrack = airTrackAnalysis(airTrackRecords);
  const gauge = gaugeBlockCalibration();
  const thermometer = thermometerCalibration(thermometerPoints, { temperature: 30 });
  // 此页给出设备和计算流程，下面是用 g=9.80、v₀=0.55 构造的合成读数。
  const gates = gravityFromPhotogates([0.10, 0.14, 0.18, 0.22, 0.26, 0.30].map(elapsedTime => ({
    elapsedTime, heightDifference: 0.55 * elapsedTime + 4.90 * elapsedTime ** 2
  })));
  const design = uncertaintyBudget({ targetAbsolute: 0.005, coverageFactor: 3, terms: [
    { name: '直径', sensitivity: 2 / 8, standardUncertainty: 0.004 / 3 },
    { name: '高度', sensitivity: 1 / 32 }
  ] });
  return {
    kepler: kepler.exponents,
    pendulumCorrections: rankCorrections(pendulum.terms, 0.001),
    thermistor: { BKelvin: thermistor.temperatureCoefficientK, R0Ohm: thermistor.resistanceAtInfiniteTemperatureOhm },
    cylinder: { mean: cylinder.value, standardA: cylinder.typeA.standardUncertainty,
      standardB: cylinder.typeB[0].standardUncertainty, standardCombined: cylinder.combined.standardUncertainty,
      report: cylinder.report.text },
    gaugeBlock: { lengthMm: gauge.lengthMm, standardUncertaintyNm: gauge.combinedStandardUncertaintyNm },
    thermometer: { ...thermometer.prediction, parameterCorrelation: thermometer.parameterCorrelation,
      minimumVarianceTemperature: thermometer.minimumVarianceTemperature },
    airTrack: { accelerationMps2: airTrack.linearAcceleration, standardErrorMps2: airTrack.linearAccelerationStandardError,
      quadraticCoefficient: airTrack.quadratic.coefficients[0] },
    syntheticPhotogates: { gravityMps2: gates.gravity, initialVelocityMps: gates.initialVelocity },
    cylinderDesign: { maximumStandardUncertaintyOfHeightMm: design.allocations[0].maxStandardUncertainty }
  };
}

export function airTrackGraph() {
  const { rows, linear } = airTrackAnalysis(airTrackRecords);
  const points = rows.map(row => [2 * row.distanceM, row.velocitySquared]);
  const ends = [points[0][0], points.at(-1)[0]];
  const overlay = ends.map(x => [x, linear.intercept + linear.slope * x]);
  return plotToSvg(plotData(points, {
    title: '气垫导轨实验　速度平方与滑行距离', xLabel: '2s', xUnit: 'm', yLabel: 'v²', yUnit: 'm²/s²'
  }), { overlays: [overlay] });
}

export const INTEL_BENCHMARK_URL = "https://mena-intelligence.vercel.app/price-benchmark"

export const benchmarkUrl = (sku: string) => `${INTEL_BENCHMARK_URL}?q=${encodeURIComponent(sku)}`

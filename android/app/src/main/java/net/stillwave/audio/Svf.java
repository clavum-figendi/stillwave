package net.stillwave.audio;

/** Topology-preserving state-variable filter (Simper), as in web/js/engine/synth.js. */
final class Svf {
    double ic1, ic2, a1, a2, a3, k = 1, low, band, high;
    void set(double sampleRate, double cutoff, double q) {
        double g = Math.tan(Math.PI * Math.min(cutoff, sampleRate * .45) / sampleRate);
        k = 1 / q; a1 = 1 / (1 + g * (g + k)); a2 = g * a1; a3 = g * a2;
    }
    void reset() { ic1 = 0; ic2 = 0; }
    double run(double v0) {
        double v3 = v0 - ic2, v1 = a1 * ic1 + a2 * v3, v2 = ic2 + a2 * ic1 + a3 * v3;
        ic1 = 2 * v1 - ic1; ic2 = 2 * v2 - ic2;
        low = v2; band = v1; high = v0 - k * v1 - v2;
        return v2;
    }
}

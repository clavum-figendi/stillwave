package net.stillwave.audio;

/** xorshift32, bit-identical to Rng in web/js/engine/composer.js. */
final class Rng {
    int s;
    Rng(long seed) { reseed(seed); }
    void reseed(long seed) { s = (int) (seed & 0xffffffffL); if (s == 0) s = 0x9e3779b9; }
    double next() { int x = s; x ^= x << 13; x ^= x >>> 17; x ^= x << 5; s = x; return (x & 0xffffffffL) / 4294967296.0; }
    int nextInt(int n) { return (int) Math.floor(next() * n); }
    double range(double a, double b) { return a + (b - a) * next(); }
    boolean chance(double p) { return next() < p; }
}

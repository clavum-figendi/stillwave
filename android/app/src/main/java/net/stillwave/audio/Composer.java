package net.stillwave.audio;

/** Deterministic generative composer: a line-for-line port of web/js/engine/composer.js. Keep both in step. */
final class Composer {
    interface Sink { void note(double beat, double beats, int midi, double velocity, int instrument, int layer, double pan); }

    static final int SINE = 0, TRI = 1, WARM = 2, FMPAD = 3, ORGAN = 4, EPIANO = 5, BELL = 6, PLUCK = 7, PIANO = 8, MALLET = 9, CHOIR = 10, FLUTE = 11,
            BASS = 12, SUB = 13, SYNTH = 14, GLASS = 15, KICK = 16, SNARE = 17, HAT = 18, SHAKER = 19, RIM = 20, BRUSH = 21;
    static final int PAD = 0, ARP = 1, MELODY = 2, BASS_LAYER = 3, DRUMS = 4;

    static final class Style {
        final double bpmLo, bpmHi, leadRate, swing, reverb, delay, tape, vinyl;
        final String lang, comp, bassPat, arpPat, kit;
        final String[] scales;
        final boolean penta;
        final int bars, ext, pad, padLo, padHi, bass, lead, leadLo, leadHi, grid, arp, spark;
        Style(double bpmLo, double bpmHi, String lang, String[] scales, boolean penta, int bars, int ext, int pad, String comp, int padLo, int padHi,
              int bass, String bassPat, int lead, double leadRate, int leadLo, int leadHi, int grid, int arp, String arpPat, int spark, String kit,
              double swing, double reverb, double delay, double tape, double vinyl) {
            this.bpmLo = bpmLo; this.bpmHi = bpmHi; this.lang = lang; this.scales = scales; this.penta = penta; this.bars = bars; this.ext = ext;
            this.pad = pad; this.comp = comp; this.padLo = padLo; this.padHi = padHi; this.bass = bass; this.bassPat = bassPat; this.lead = lead;
            this.leadRate = leadRate; this.leadLo = leadLo; this.leadHi = leadHi; this.grid = grid; this.arp = arp; this.arpPat = arpPat;
            this.spark = spark; this.kit = kit; this.swing = swing; this.reverb = reverb; this.delay = delay; this.tape = tape; this.vinyl = vinyl;
        }
    }
    private static String[] s(String... v) { return v; }
    static Style style(String name) {
        switch (name) {
            case "lofi": return new Style(70, 86, "jazz", s("major", "dorian"), false, 1, 2, EPIANO, "stab", 50, 72, BASS, "walk", PLUCK, .9, 64, 84, 16, -1, "", -1, "lofi", .17, .45, .15, .5, .6);
            case "piano": return new Style(58, 70, "bright", s("major", "minor"), false, 1, 1, PIANO, "broken", 48, 70, PIANO, "roots", PIANO, .75, 67, 88, 8, -1, "", -1, "", 0, .6, .08, 0, 0);
            case "kalimba": return new Style(92, 108, "loop", s("major", "mixolydian"), true, 1, 0, SINE, "hold", 52, 70, PLUCK, "roots", MALLET, .8, 72, 90, 8, MALLET, "random", -1, "shaker", .06, .45, .35, 0, 0);
            case "pulse": return new Style(104, 120, "loop", s("minor", "dorian"), false, 2, 1, WARM, "hold", 50, 70, BASS, "pulse", BELL, .35, 72, 88, 8, SYNTH, "phase", -1, "pulse", 0, .5, .4, 0, 0);
            case "glass": return new Style(84, 98, "loop", s("lydian", "major"), true, 1, 2, FMPAD, "swell", 55, 76, SUB, "roots", GLASS, .55, 76, 96, 8, BELL, "updown", GLASS, "", 0, .7, .5, 0, 0);
            case "drift": return new Style(50, 58, "modal", s("dorian", "lydian", "minor"), false, 4, 2, WARM, "swell", 48, 72, SUB, "drone", FLUTE, .3, 64, 82, 8, -1, "", BELL, "", 0, 1, .3, .2, 0);
            case "choir": return new Style(54, 64, "modal", s("minor", "dorian", "major"), false, 2, 1, CHOIR, "swell", 50, 72, SUB, "drone", FLUTE, .35, 65, 82, 8, -1, "", BELL, "", 0, .95, .15, 0, 0);
            case "tape": return new Style(66, 78, "bright", s("major", "mixolydian"), false, 2, 1, ORGAN, "hold", 50, 72, BASS, "roots", FLUTE, .7, 66, 84, 8, -1, "", -1, "brush", .1, .4, .2, 1, .3);
            case "deep": return new Style(48, 56, "modal", s("minor", "dorian"), false, 4, 1, TRI, "swell", 40, 62, SUB, "drone", FLUTE, .2, 55, 72, 8, -1, "", BELL, "", 0, 1, .2, 0, 0);
            default: return new Style(62, 72, "bright", s("major", "lydian"), false, 2, 2, WARM, "swell", 50, 74, SUB, "drone", BELL, .45, 70, 88, 8, -1, "", GLASS, "", 0, .85, .3, 0, 0);
        }
    }
    private static int[] scaleSteps(String name) {
        switch (name) {
            case "minor": return new int[]{0, 2, 3, 5, 7, 8, 10};
            case "dorian": return new int[]{0, 2, 3, 5, 7, 9, 10};
            case "lydian": return new int[]{0, 2, 4, 6, 7, 9, 11};
            case "mixolydian": return new int[]{0, 2, 4, 5, 7, 9, 10};
            default: return new int[]{0, 2, 4, 5, 7, 9, 11};
        }
    }
    private static final int[] PENTA_MAJOR = {0, 1, 2, 4, 5}, PENTA_MINOR = {0, 2, 3, 4, 6}, ALL_DEGREES = {0, 1, 2, 3, 4, 5, 6};
    // [degree][option] = {next, weight}
    private static final double[][][] BRIGHT = {{{3, 3}, {5, 3}, {4, 2}, {1, 1.5}, {2, 1}}, {{4, 4}, {3, 1}, {0, 1}}, {{5, 3}, {3, 2}}, {{0, 3}, {4, 3}, {1, 1.5}, {5, 1}}, {{0, 4}, {5, 2}, {3, 1}}, {{3, 3}, {1, 2}, {4, 2}, {2, 1}}, {{0, 3}, {2, 1}}};
    private static final double[][][] JAZZ = {{{5, 3}, {1, 2}, {3, 2}, {2, 1}}, {{4, 5}, {6, 1}}, {{5, 3}, {1, 1}}, {{4, 2}, {1, 2}, {2, 1}, {0, 1}}, {{0, 4}, {2, 1}, {5, 1}}, {{1, 4}, {3, 2}}, {{2, 2}, {0, 1}}};
    private static final double[][][] MODAL = {{{6, 3}, {5, 3}, {3, 2}, {2, 1}}, {{0, 2}, {6, 1}}, {{5, 2}, {6, 2}}, {{0, 3}, {6, 1}, {5, 1}}, {{0, 3}, {5, 1}}, {{6, 3}, {0, 2}, {3, 1}}, {{0, 4}, {5, 1}}};
    private static final int[][] LOOPS = {{0, 4, 5, 3}, {5, 3, 0, 4}, {0, 5, 3, 4}, {0, 3, 5, 4}, {3, 0, 4, 5}, {0, 6, 5, 6}, {0, 3, 6, 5}, {0, 2, 3, 4}};
    private static double[][][] lang(String name) { return name.equals("jazz") ? JAZZ : name.equals("modal") ? MODAL : BRIGHT; }
    private static final int[] LOFI_INST = {KICK, SNARE, HAT}, PULSE_INST = {KICK, HAT, SHAKER}, SHAKER_INST = {SHAKER, RIM}, BRUSH_INST = {KICK, BRUSH, HAT};
    private static final double[][] LOFI = {{1, 0, 0, 0, 0, 0, 0, .35, 0, 0, .9, 0, 0, 0, 0, 0}, {0, 0, 0, 0, .85, 0, 0, 0, 0, 0, 0, 0, .85, 0, 0, .15}, {.6, 0, .45, 0, .6, 0, .45, 0, .6, 0, .45, 0, .6, 0, .45, .3}};
    private static final double[][] PULSE = {{.7, 0, 0, 0, .7, 0, 0, 0, .7, 0, 0, 0, .7, 0, 0, 0}, {0, 0, .5, 0, 0, 0, .5, 0, 0, 0, .5, 0, 0, 0, .5, 0}, {.25, .15, .25, .15, .25, .15, .25, .15, .25, .15, .25, .15, .25, .15, .25, .15}};
    private static final double[][] SHAKER_KIT = {{.5, 0, .3, 0, .5, 0, .3, 0, .5, 0, .3, 0, .5, 0, .3, .2}, {0, 0, 0, 0, 0, 0, .3, 0, 0, 0, 0, 0, 0, 0, .25, 0}};
    private static final double[][] BRUSH_KIT = {{.6, 0, 0, 0, 0, 0, 0, 0, .5, 0, 0, 0, 0, 0, 0, 0}, {0, 0, 0, 0, .7, 0, 0, 0, 0, 0, 0, 0, .7, 0, 0, 0}, {.3, 0, .2, 0, .3, 0, .2, 0, .3, 0, .2, 0, .3, 0, .2, 0}};
    private static final int[] STAB_A = {0, 6}, STAB_B = {0, 7, 10}, STAB_C = {2, 8}, BROKEN_A = {0, 1, 2, 3, 2, 1, 2, 3}, BROKEN_B = {0, 2, 1, 3, 0, 2, 1, 3};
    private static final int[] LENGTHS_16 = {2, 2, 4, 3, 6}, LENGTHS_8 = {1, 2, 2, 3, 4};

    final Rng rng;
    final int[] prev = new int[5], home = new int[4], phrase = new int[4], chordTones = new int[5], motif = new int[32], motifB = new int[32];
    private final int[] voicing = new int[5], candidate = new int[5], line = new int[4];
    int prevCount, motifCount, motifBCount, chordCount, leadNote, arpStep, root, keySetting = Integer.MIN_VALUE, barInPhrase, phraseCount, sectionPhrase, chordBars;
    Settings settings;
    Style style;
    String styleName, scaleName, scaleSetting;
    int[] scale;
    double baseBpm, bpm, energy, energyTarget, modeTempo, modeEnergy;
    boolean modeDrums;

    Composer(Settings settings) { rng = new Rng(settings.seed); configure(settings, true); }

    void configure(Settings s, boolean initial) {
        boolean styleChanged = initial || !s.style.equals(styleName);
        settings = s; styleName = s.style; style = style(s.style);
        modeTempo = s.mode.equals("relax") ? .9 : s.mode.equals("meditate") ? .85 : s.mode.equals("sleep") ? .78 : 1;
        modeEnergy = s.mode.equals("relax") ? .85 : s.mode.equals("meditate") ? .7 : s.mode.equals("sleep") ? .5 : 1;
        modeDrums = s.mode.equals("focus") || s.mode.equals("relax");
        if (styleChanged || s.key != keySetting || !s.scale.equals(scaleSetting)) {
            Style st = style;
            keySetting = s.key; scaleSetting = s.scale;
            root = 48 + (s.key >= 0 ? s.key : rng.nextInt(12));
            if (root > 54) root -= 12;
            scaleName = !s.scale.equals("auto") ? s.scale : st.scales[rng.nextInt(st.scales.length)];
            baseBpm = st.bpmLo + (st.bpmHi - st.bpmLo) * rng.next();
            scale = scaleSteps(scaleName);
            newHome();
            barInPhrase = 0; phraseCount = 0; sectionPhrase = 0;
            energy = .3; energyTarget = .5;
            System.arraycopy(home, 0, phrase, 0, 4);
            makeMotif(motif, true);
            makeMotif(motifB, false);
            leadNote = (st.leadLo + st.leadHi) >> 1;
        }
        scale = scaleSteps(scaleName);
        chordBars = style.bars * (s.mode.equals("sleep") || (s.mode.equals("meditate") && style.bars == 1) ? 2 : 1);
        bpm = baseBpm * modeTempo;
    }

    private int pickWeighted(double[][] options) {
        double total = 0;
        for (double[] option : options) total += option[1];
        double r = rng.next() * total;
        for (double[] option : options) { r -= option[1]; if (r <= 0) return (int) option[0]; }
        return (int) options[options.length - 1][0];
    }

    private void newHome() {
        if (style.lang.equals("loop")) { int[] loop = LOOPS[rng.nextInt(LOOPS.length)]; System.arraycopy(loop, 0, home, 0, 4); return; }
        double[][][] table = lang(style.lang);
        int degree = 0;
        home[0] = 0;
        for (int i = 1; i < 4; i++) { degree = pickWeighted(table[degree]); home[i] = degree; }
        if (home[3] == 0) home[3] = style.lang.equals("modal") ? 6 : 4;
    }

    private void makeMotif(int[] target, boolean question) {
        Style st = style;
        int steps = st.grid * 2, stride = st.grid == 16 ? 2 : 1, count = 0, step = rng.chance(.4) ? stride : 0;
        while (step < steps - stride && count < 10) {
            int[] lengths = st.grid == 16 ? LENGTHS_16 : LENGTHS_8;
            int length = lengths[rng.nextInt(lengths.length)];
            int interval = rng.chance(.15) ? (rng.chance(.5) ? 3 : -3) : rng.nextInt(5) - 2;
            target[count * 3] = step; target[count * 3 + 1] = length; target[count * 3 + 2] = question ? interval : -Math.abs(interval) + (rng.chance(.3) ? 1 : 0);
            count++;
            step += length + (rng.chance(.25) ? stride * 2 : 0);
        }
        target[(count - 1) * 3 + 1] = Math.max(target[(count - 1) * 3 + 1], st.grid == 16 ? 6 : 3);
        if (target == motif) motifCount = count; else motifBCount = count;
    }

    int pitch(int degree) { int d = ((degree % 7) + 7) % 7; return root + scale[d] + 12 * Math.floorDiv(degree, 7); }

    private void buildChord(int degree) {
        int extra = style.ext, n = 0, count = extra == 0 ? 3 : extra == 1 ? 4 : 5;
        for (int i = 0; i < count; i++) {
            if (count == 5 && i == 2 && rng.chance(.6)) continue;
            if (i == 4 && ((pitch(degree + 8) - pitch(degree)) % 12 + 12) % 12 != 2) continue;
            chordTones[n++] = pitch(degree + i * 2) % 12;
        }
        chordCount = n;
    }

    private int voice(int[] out, int lo, int hi) {
        int n = chordCount, best = -1;
        double bestCost = 1e9;
        for (int r = 0; r < n; r++) {
            int note = lo + ((chordTones[r] - lo) % 12 + 12) % 12;
            for (int k = 0; k < n; k++) {
                int pc = chordTones[(r + k) % n];
                if (k > 0) { note += ((pc - note) % 12 + 12) % 12; if (note <= candidate[k - 1]) note += 12; }
                candidate[k] = note;
            }
            if (candidate[n - 1] > hi + 4) continue;
            double cost = 0;
            if (prevCount == n) for (int k = 0; k < n; k++) cost += Math.abs(candidate[k] - prev[k]);
            else cost = Math.abs(candidate[0] + candidate[n - 1] - lo - hi);
            cost += rng.next() * .5;
            if (cost < bestCost) { bestCost = cost; best = r; System.arraycopy(candidate, 0, out, 0, n); }
        }
        if (best < 0) for (int k = 0; k < n; k++) out[k] = lo + ((chordTones[k] - lo) % 12 + 12) % 12 + (k > 0 && chordTones[k] < chordTones[0] ? 12 : 0);
        System.arraycopy(out, 0, prev, 0, n);
        prevCount = n;
        return n;
    }

    private void nextPhrase() {
        phraseCount++; sectionPhrase++;
        if (sectionPhrase >= 4) {
            sectionPhrase = 0;
            if (rng.chance(.5)) newHome();
            if (settings.key < 0 && rng.chance(.25)) { root += rng.chance(.5) ? 5 : -5; if (root > 55) root -= 12; if (root < 43) root += 12; }
            makeMotif(motif, true);
        }
        System.arraycopy(home, 0, phrase, 0, 4);
        if (sectionPhrase == 2) {
            int changes = 1 + rng.nextInt(2);
            for (int c = 0; c < changes; c++) {
                int at = 1 + rng.nextInt(3);
                double[][][] table = lang(style.lang.equals("loop") ? "bright" : style.lang);
                phrase[at] = pickWeighted(table[phrase[at - 1]]);
            }
            makeMotif(motifB, false);
        }
        barInPhrase = 0;
    }

    private static double at16(int step, double swing) { return step / 4.0 + (step % 2 == 1 ? swing : 0); }

    void bar(Sink sink) {
        Style st = style; Settings s = settings;
        if (barInPhrase >= chordBars * 4) nextPhrase();
        int chordIndex = barInPhrase / chordBars;
        boolean chordStart = barInPhrase % chordBars == 0;
        int degree = phrase[chordIndex];
        buildChord(degree);
        if ((phraseCount * 16 + barInPhrase) % 8 == 0) energyTarget = Math.max(.05, Math.min(1, .15 + .75 * s.density * modeEnergy + rng.range(-.25, .25)));
        energy += (energyTarget - energy) * .35;
        double e = energy, density = .4 + s.density * 1.2, swing = st.swing;
        int padInst = synthOverride(s.synth, st.pad);
        int n = voice(voicing, st.padLo, st.padHi);
        int rootMidi = pitch(degree) % 12, bassRoot = 36 + ((rootMidi - 36) % 12 + 12) % 12;

        if (st.comp.equals("swell") || st.comp.equals("hold")) {
            if (chordStart) {
                double length = chordBars * 4 + (st.comp.equals("swell") ? 1.5 : .25);
                for (int k = 0; k < n; k++) sink.note(k * (st.comp.equals("swell") ? .12 : .02), length, voicing[k], .5 - k * .04, padInst, PAD, (k / (double) Math.max(1, n - 1) - .5) * .8);
            }
        } else if (st.comp.equals("stab")) {
            int[] hits = rng.chance(.5) ? STAB_A : rng.chance(.5) ? STAB_B : STAB_C;
            for (int h = 0; h < hits.length; h++) for (int k = 0; k < n; k++) sink.note(at16(hits[h], swing) + k * .012, h == hits.length - 1 ? 2.5 : 1.4, voicing[k], .42 - k * .03 + rng.range(-.04, .04), padInst, PAD, (k / (double) Math.max(1, n - 1) - .5) * .6);
        } else if (st.comp.equals("broken")) {
            int[] pattern = rng.chance(.5) ? BROKEN_A : BROKEN_B;
            for (int i = 0; i < 8; i++) { if (i > 0 && rng.next() > .5 + e * .5) continue; int note = voicing[pattern[i] % n]; sink.note(i * .5 + rng.range(0, .02), 3, note, .32 + (i == 0 ? .12 : 0) + rng.range(-.05, .05), padInst, PAD, (pattern[i] / 3.0 - .5) * .5); }
        }

        switch (st.bassPat) {
            case "drone": if (chordStart) sink.note(0, chordBars * 4 + 1, bassRoot, .55, st.bass, BASS_LAYER, 0); break;
            case "roots": sink.note(0, 2.5, bassRoot, .6, st.bass, BASS_LAYER, 0); if (rng.chance(.4 + e * .4)) sink.note(2, 1.8, bassRoot + (rng.chance(.6) ? 7 : 12), .45, st.bass, BASS_LAYER, 0); break;
            case "walk": {
                int next = pitch(phrase[(chordIndex + 1) % 4]) % 12, target = 36 + ((next - 36) % 12 + 12) % 12;
                line[0] = bassRoot; line[1] = bassRoot + (rng.chance(.5) ? 7 : 4); line[2] = bassRoot + (rng.chance(.5) ? 12 : 9); line[3] = target + (rng.chance(.5) ? -1 : 1);
                for (int b = 0; b < 4; b++) if (b == 0 || rng.chance(.35 + e * .5)) sink.note(b + (b % 2 == 1 ? swing * .5 : 0), .9, line[b], .55, st.bass, BASS_LAYER, 0);
                break;
            }
            case "pulse": for (int i = 0; i < 8; i++) sink.note(i * .5, .4, bassRoot + (i % 4 == 3 && rng.chance(.4) ? 12 : 0), i % 2 == 1 ? .38 : .5, st.bass, BASS_LAYER, 0); break;
            default: break;
        }

        if (st.arp >= 0 && (st.arpPat.equals("phase") || e > .3)) {
            int grid = st.arpPat.equals("phase") || st.arpPat.equals("updown") ? 16 : 8;
            for (int i = 0; i < grid; i++) {
                int idx;
                if (st.arpPat.equals("phase")) idx = (arpStep * 3 + (arpStep >> 2)) % (n + 1);
                else if (st.arpPat.equals("updown")) { int span = n * 2 - 2, p = arpStep % Math.max(1, span); idx = p < n ? p : span - p; }
                else idx = rng.nextInt(n + 1);
                arpStep++;
                if (rng.next() > (st.arpPat.equals("phase") ? .92 : .25 + e * .55 * density)) continue;
                int note = (idx >= n ? voicing[0] + 12 : voicing[idx]) + 12 - (st.arp == SYNTH ? 12 : 0);
                sink.note(i * 4.0 / grid, grid == 16 ? .45 : .9, melodic(note), (st.arpPat.equals("phase") ? .3 : .26) + (i % 4 == 0 ? .08 : 0) + rng.range(-.04, .04), st.arp, ARP, Math.sin(arpStep * .7) * .6);
            }
        }

        boolean playLead = s.melodyVolume > 0 && e > .25 && (sectionPhrase != 1 || e > .55) && rng.next() < .55 + e * .5;
        if (playLead) {
            int[] m = sectionPhrase == 2 ? motifB : motif;
            int count = sectionPhrase == 2 ? motifBCount : motifCount, half = barInPhrase % 2, stepsPerBar = st.grid;
            double beat = 4.0 / stepsPerBar;
            boolean phraseEnd = barInPhrase == chordBars * 4 - 1;
            if (barInPhrase == 0) leadNote = nearestChordTone((st.leadLo + st.leadHi) >> 1);
            for (int k = 0; k < count; k++) {
                int step = m[k * 3], length = m[k * 3 + 1];
                if (step / stepsPerBar != half) continue;
                if (rng.next() > st.leadRate * density + .15) continue;
                int interval = m[k * 3 + 2];
                if (phraseCount % 2 == 1 && rng.chance(.3)) interval = -interval;
                int note = stepScale(leadNote, interval), local = step % stepsPerBar;
                if (local % (stepsPerBar / 2) == 0) note = nearestChordTone(note);
                while (note > st.leadHi) note -= 12;
                while (note < st.leadLo) note += 12;
                leadNote = note;
                boolean last = phraseEnd && k == count - 1;
                sink.note(local * beat + (local % 2 == 1 && stepsPerBar == 16 ? swing : 0) + rng.range(0, .015), length * beat * (last ? 2 : 1.1), last ? nearestChordTone(note) : note, .5 + rng.range(-.08, .08), st.lead, MELODY, rng.range(-.3, .3));
            }
        }

        if (st.spark >= 0 && rng.chance(.12 + e * .25)) {
            int note = melodic(nearestChordTone(st.leadLo + 12 + rng.nextInt(10)));
            sink.note(rng.nextInt(8) * .5, 3, note, .22 + rng.range(0, .1), st.spark, MELODY, rng.range(-.8, .8));
        }

        if (!st.kit.isEmpty() && modeDrums && s.beatVolume > 0 && (e > .2 || st.kit.equals("pulse"))) {
            int[] instruments = st.kit.equals("lofi") ? LOFI_INST : st.kit.equals("pulse") ? PULSE_INST : st.kit.equals("shaker") ? SHAKER_INST : BRUSH_INST;
            double[][] patterns = st.kit.equals("lofi") ? LOFI : st.kit.equals("pulse") ? PULSE : st.kit.equals("shaker") ? SHAKER_KIT : BRUSH_KIT;
            boolean fill = barInPhrase == chordBars * 4 - 1;
            for (int d = 0; d < instruments.length; d++) {
                int inst = instruments[d];
                for (int i = 0; i < 16; i++) {
                    double p = patterns[d][i];
                    if (fill && i >= 12 && inst != KICK) p = Math.max(p, .35);
                    if (p <= 0 || rng.next() > Math.min(1, p * (.55 + e * .6))) continue;
                    sink.note(at16(i, swing) + rng.range(0, .012), .25, 60, Math.min(1, p * .9 + rng.range(-.1, .1)), inst, DRUMS, inst == HAT || inst == SHAKER ? .25 : 0);
                }
            }
        }
        barInPhrase++;
    }

    static int synthOverride(String synth, int fallback) {
        switch (synth) {
            case "sine": return SINE; case "triangle": return TRI; case "warm": return WARM; case "fm": return FMPAD;
            case "organ": return ORGAN; case "epiano": return EPIANO; case "bell": return BELL; case "pluck": return PLUCK;
            default: return fallback;
        }
    }

    private boolean minorish() { return scaleName.equals("minor") || scaleName.equals("dorian"); }

    private int melodic(int note) {
        if (!style.penta) return note;
        int[] allowed = minorish() ? PENTA_MINOR : PENTA_MAJOR;
        for (int offset = 0; offset < 3; offset++) for (int sign = 0; sign < 2; sign++) {
            int candidate = note + (sign == 1 ? -offset : offset);
            for (int a : allowed) if (((candidate - root - scale[a]) % 12 + 12) % 12 == 0) return candidate;
        }
        return note;
    }

    private int nearestChordTone(int note) {
        int best = note, bestDistance = 99;
        for (int k = 0; k < chordCount; k++) for (int o = -1; o <= 1; o++) {
            int candidate = note - ((note - chordTones[k]) % 12 + 12) % 12 + o * 12, distance = Math.abs(candidate - note);
            if (distance < bestDistance) { bestDistance = distance; best = candidate; }
        }
        return best;
    }

    private int stepScale(int note, int steps) {
        int[] allowed = style.penta ? (minorish() ? PENTA_MINOR : PENTA_MAJOR) : ALL_DEGREES;
        int size = allowed.length, index = 0, octave = Math.floorDiv(note - root, 12), best = 99;
        for (int a = 0; a < size; a++) { int d = Math.abs(root + 12 * octave + scale[allowed[a]] - note); if (d < best) { best = d; index = a; } }
        int position = octave * size + index + steps, o = Math.floorDiv(position, size), i = ((position % size) + size) % size;
        return root + 12 * o + scale[allowed[i]];
    }
}

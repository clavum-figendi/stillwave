package net.stillwave.audio;

import java.util.Map;
import java.util.HashMap;

/** Expanded shared controls and real signal contracts, no Android dependencies. */
public final class ExpansionTests {
    private static int scenarios;
    private static void check(boolean value, String label) {
        scenarios++; if (!value) throw new AssertionError(label);
    }
    public static void main(String[] args) {
        settings();
        layers();
        families();
        transitions();
        modulation();
        System.out.println("PASS " + scenarios + " expansion scenarios");
    }
    static float[] render(Map<String,Object> extra) {
        Map<String,Object> values=new HashMap<>(Map.of("seed",42,"volume",.7,"intensity",0,"space",0));values.putAll(extra);
        SignalGenerator generator=new SignalGenerator(44100,Settings.from(values));generator.setPlaying(true);
        float[] audio=new float[44100*6*2];generator.render(audio,audio.length/2);return audio;
    }
    static double difference(float[] a,float[] b) {
        double sum=0;for(int i=0;i<a.length;i++)sum+=(a[i]-b[i])*(a[i]-b[i]);return Math.sqrt(sum/a.length);
    }
    static double peak(float[] a) {double p=0;boolean finite=true;for(float x:a){finite &= Float.isFinite(x);p=Math.max(p,Math.abs(x));}check(finite,"finite rendered signal");return p;}
    static void layers() {
        float[] reference=render(Map.of());
        for(String key:new String[]{"musicVolume","bassVolume","melodyVolume","brightness","space","stereo","density"})
            check(difference(reference,render(Map.of(key,key.equals("space")?1:0)))>.00005,"audible control "+key);
        float[] mono=render(Map.of("stereo",0,"space",1));boolean same=true;
        for(int i=0;i<mono.length;i+=2)same &= mono[i]==mono[i+1];check(same,"true mono including reverb");
        check(peak(render(Map.of("musicVolume",0,"bassVolume",0,"melodyVolume",0,"space",1)))==0,"zero layers exact silence");
    }
    static void families() {
        family("style",new String[]{"ambient","lofi","deep","glass","drift","tape"},Map.of());
        family("synth",new String[]{"sine","triangle","fm","organ"},Map.of());
        family("ambience",new String[]{"rain","brown","pink","ocean","wind","fire"},Map.of("musicVolume",0,"bassVolume",0,"melodyVolume",0,"ambienceVolume",1));
    }
    static void family(String key,String[] choices,Map<String,Object> base) {
        float[][] signals=new float[choices.length][];
        for(int i=0;i<choices.length;i++) {
            Map<String,Object> controls=new HashMap<>(base);controls.put(key,choices[i]);
            signals[i]=render(controls);double max=peak(signals[i]);
            check(max>.001&&max<.81,"audible bounded "+choices[i]);
            for(int j=0;j<i;j++)check(difference(signals[i],signals[j])>.0001,"distinct "+choices[i]+" / "+choices[j]);
        }
    }
    static void transitions() {
        SignalGenerator g=new SignalGenerator(48000,Settings.from(Map.of("seed",42,"stereo",0,"space",1)));
        g.setPlaying(true);float[] audio=new float[48000*2];g.render(audio,48000);
        g.setSettings(Settings.from(Map.of("seed",42,"stereo",1,"space",1,"synth","organ","style","glass","brightness",1)));
        float previous=audio[audio.length-2];g.render(audio,48000);double step=Math.abs(audio[0]-previous),side=0;
        for(int i=2;i<audio.length;i+=2){step=Math.max(step,Math.abs(audio[i]-audio[i-2]));side=Math.max(side,Math.abs(audio[i]-audio[i+1]));}
        check(side>.001,"mono to stereo affects active sustained voices");check(step<.15,"timbre/style/width changes are click-free");
        g.setSettings(Settings.from(Map.of("stereo",0,"space",1)));g.render(audio,48000);
        boolean mono=true;for(int i=48000;i<audio.length;i+=2)mono &= audio[i]==audio[i+1];check(mono,"stereo to exact mono settles within one second");
        g.setSettings(Settings.from(Map.of("volume",0,"ambience","fire","ambienceVolume",1)));g.render(audio,48000);
        boolean silent=true;for(int i=48000;i<audio.length;i++)silent &= audio[i]==0;check(silent,"mute settles to exact silence");
        g.setSettings(Settings.from(Map.of("musicVolume",0,"bassVolume",0,"melodyVolume",0,"space",1)));g.render(audio,48000);
        silent=true;for(int i=48000;i<audio.length;i++)silent &= audio[i]==0;check(silent,"muted layers settle without reverb residue");
    }
    static double modulationDepth(float[] audio) {
        double re=0,im=0,power=0;int hop=120;
        for(int i=44100*2;i<audio.length/2-hop;i+=hop){double sum=0;
            for(int j=i;j<i+hop;j++)sum+=audio[j*2]*audio[j*2];
            double env=Math.sqrt(sum/hop),t=(i+hop*.5)/44100.;power+=env;re+=env*Math.cos(TAU16*t);im+=env*Math.sin(TAU16*t);}
        return 2*Math.hypot(re,im)/power;
    }
    private static final double TAU16=2*Math.PI*16;
    static void modulation() {
        double off=modulationDepth(render(Map.of("musicVolume",1,"bassVolume",0,"melodyVolume",0,"intensity",0)));
        double on=modulationDepth(render(Map.of("musicVolume",1,"bassVolume",0,"melodyVolume",0,"intensity",.6)));
        check(on>.12&&on>off*5,"measured default 16 Hz AM depth");
        System.out.printf(java.util.Locale.ROOT,"Native measured 16 Hz depth: off=%.5f on=%.5f%n",off,on);
    }
    static void settings() {
        Map<String,Object> defaults = Settings.from(Map.of()).toMap();
        check("sine".equals(defaults.get("synth")), "default sine synth");
        String[] keys={"brightness","space","stereo","density","musicVolume","bassVolume","melodyVolume"};
        double[] values={.5,.25,.65,.5,.8,.5,.5};
        for(int i=0;i<keys.length;i++) {
            check(Double.valueOf(values[i]).equals(defaults.get(keys[i])),"shared default " + keys[i]);
            check(Double.valueOf(0).equals(Settings.from(Map.of(keys[i],-1)).toMap().get(keys[i])),"clamp " + keys[i]);
            check(Double.valueOf(values[i]).equals(Settings.from(Map.of(keys[i],Double.NaN)).toMap().get(keys[i])),"finite " + keys[i]);
        }
        for(String style:new String[]{"ambient","lofi","deep","glass","drift","tape"}) check(Settings.from(Map.of("style",style)).style.equals(style),"style "+style);
        for(String synth:new String[]{"sine","triangle","fm","organ"}) check(synth.equals(Settings.from(Map.of("synth",synth)).toMap().get("synth")),"synth "+synth);
        for(String ambience:new String[]{"none","rain","brown","pink","ocean","wind","fire"}) check(Settings.from(Map.of("ambience",ambience)).ambience.equals(ambience),"ambience "+ambience);
        Map<String,Object> partial=new HashMap<>(Settings.from(Map.of("synth","fm","density",.9,"mode","sleep")).toMap());
        partial.put("volume",.2); Settings merged=Settings.from(partial);
        check(merged.mode.equals("sleep") && "fm".equals(merged.toMap().get("synth")) && Double.valueOf(.9).equals(merged.toMap().get("density")),"partial update preserves expanded controls");
    }
}

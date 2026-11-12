package net.stillwave.audio;

/** Stateful, allocation-free stereo synthesis, owned by the audio worker only.
 * AM covers the broad pad/melody bus, not a selected frequency band. Bass and
 * ambience bypass AM. This is a musical effect, not a medical treatment.
 * Fixed voices and two bounded delay lines keep per-frame work/memory constant.
 */
public final class SignalGenerator {
    private static final double TAU = Math.PI * 2;
    private static final int[][] CHORDS = {{0, 3, 7}, {0, 5, 8}, {-2, 3, 7}, {-5, 2, 7}};
    private static final String[] STYLES={"ambient","lofi","deep","glass","drift","tape"};
    private static final String[] SYNTHS={"sine","triangle","fm","organ"};
    private static final String[] TEXTURES={"rain","brown","pink","ocean","wind","fire"};
    private static final double[] TONES={650,380,260,1600,800,470};
    private static final double[] STEPS={1,.5,2,1.5,2,.75};
    private static final double[] DETUNE={5,9,3,2,12,8};
    private final int sampleRate;
    private final double smoothing;
    private final double[] phaseL=new double[3],phaseR=new double[3],frequencies=new double[3],targets=new double[3];
    private final double[] styles=new double[6],synths=new double[4],textures=new double[6];
    private final double[] delayL,delayR;
    private Settings settings;
    private long frames,rng;
    private int delayIndexL,delayIndexR,targetChord=-1;
    private double volume,intensity,rate,ambienceVolume,musicVolume,bassVolume,melodyVolume,space,stereo;
    private double envelope,amPhase,bassPhase,notePhase,noteBeat,wowPhase,brown,slow,midNoise,fast,crackle;
    private double filterAlpha,filteredL,filteredR,cadence,detune,ambienceFiltered;
    private boolean playing;

    public SignalGenerator(int sampleRate,Settings settings) {
        if(sampleRate!=44100&&sampleRate!=48000)throw new IllegalArgumentException("Unsupported sample rate");
        this.sampleRate=sampleRate;this.settings=settings;
        smoothing=1-Math.exp(-1.0/(sampleRate*.22));
        volume=settings.volume;intensity=settings.intensity;rate=settings.rate;ambienceVolume=settings.ambienceVolume;
        musicVolume=settings.musicVolume;bassVolume=settings.bassVolume;melodyVolume=settings.melodyVolume;
        space=settings.space;stereo=settings.stereo;
        int style=index(STYLES,settings.style);styles[style]=1;synths[index(SYNTHS,settings.synth)]=1;
        int texture=index(TEXTURES,settings.ambience);if(texture>=0)textures[texture]=1;
        filterAlpha=alpha(style,settings.brightness);cadence=cadence(style,settings);detune=DETUNE[style];
        delayL=new double[(int)(sampleRate*.173)];delayR=new double[(int)(sampleRate*.229)];
        rng=settings.seed;
        for(int i=0;i<3;i++) {
            phaseL[i]=random()*TAU;phaseR[i]=phaseL[i]+.13;
            frequencies[i]=220*Math.pow(2,CHORDS[0][i]/12.0);
        }
    }
    private static int index(String[] choices,String value) {
        for(int i=0;i<choices.length;i++)if(choices[i].equals(value))return i;return -1;
    }
    private double alpha(int style,double brightness) {
        return 1-Math.exp(-TAU*TONES[style]*Math.pow(2,brightness*3)/sampleRate);
    }
    private static double cadence(int style,Settings s) {
        return .45*Math.pow(2,2*s.density-1)/(s.mode.equals("sleep")?2:STEPS[style]);
    }
    public void setSettings(Settings next) {
        if(next.seed!=settings.seed)rng=next.seed;
        settings=next;targetChord=-1;
    }
    public void setPlaying(boolean playing) {this.playing=playing;}
    public long framesGenerated() {return frames;}
    public boolean isSilent() {return envelope==0;}
    private double random() {
        rng^=rng<<13;rng^=rng>>>7;rng^=rng<<17;return (rng>>>11)*0x1.0p-53;
    }
    private static double wrap(double value) {return value>=TAU?value-TAU:value;}
    private double ease(double current,double target) {
        return Math.abs(target-current)<1e-9?target:current+(target-current)*smoothing;
    }
    private double ramp(double current,double target) {
        double step=1.0/(sampleRate*.3),delta=target-current;
        return Math.abs(delta)<=step?target:current+Math.copySign(step,delta);
    }
    private double wave(double phase) {
        double sine=Math.sin(phase),value=synths[0]*sine;
        // Finite partials give a soft triangle without discontinuities/aliasing edges.
        if(synths[1]>0)value+=synths[1]*.81*(sine-Math.sin(3*phase)/9+Math.sin(5*phase)/25-Math.sin(7*phase)/49);
        if(synths[2]>0)value+=synths[2]*Math.sin(phase+.325*Math.sin(phase*2));
        if(synths[3]>0)value+=synths[3]*(sine+.45*Math.sin(phase*2)+.2*Math.sin(phase*3)+.1*Math.sin(phase*4)+.04*Math.sin(phase*8))/1.4;
        return value;
    }
    public void render(float[] output,int frameCount) {
        if(frameCount<0||frameCount>output.length/2)throw new IllegalArgumentException("Insufficient stereo buffer");
        Settings s=settings;
        int style=index(STYLES,s.style),synth=index(SYNTHS,s.synth),texture=index(TEXTURES,s.ambience);
        double targetAlpha=alpha(style,s.brightness),targetCadence=cadence(style,s);
        // A short output fade also silences already-stored diffusion when all
        // layers are disabled. No hard gate or asymptotic DC/reverb residue.
        double targetVolume=s.musicVolume==0&&s.bassVolume==0&&s.melodyVolume==0&&(texture<0||s.ambienceVolume==0)?0:s.volume;
        double transpose=s.mode.equals("sleep")?-2:s.mode.equals("relax")?-1:s.mode.equals("meditate")?2:0;
        transpose+=style==3?12:style==2?-5:0;
        for(int n=0;n<frameCount;n++,frames++) {
            volume=ramp(volume,targetVolume);intensity=ramp(intensity,s.intensity);rate=ease(rate,s.rate);
            ambienceVolume=ramp(ambienceVolume,s.ambienceVolume);
            musicVolume=ramp(musicVolume,s.musicVolume);bassVolume=ramp(bassVolume,s.bassVolume);melodyVolume=ramp(melodyVolume,s.melodyVolume);
            space=ramp(space,s.space);stereo=ramp(stereo,s.stereo);filterAlpha=ease(filterAlpha,targetAlpha);
            cadence=ease(cadence,targetCadence);detune=ease(detune,DETUNE[style]);
            for(int i=0;i<styles.length;i++)styles[i]=ease(styles[i],i==style?1:0);
            for(int i=0;i<synths.length;i++)synths[i]=ease(synths[i],i==synth?1:0);
            for(int i=0;i<textures.length;i++)textures[i]=ease(textures[i],i==texture?1:0);
            envelope=playing?Math.min(1,envelope+1.0/(sampleRate*.4)):Math.max(0,envelope-1.0/(sampleRate*.18));
            double seconds=frames/(double)sampleRate;
            int chord=(int)(seconds/(style==4?18:12))%CHORDS.length;
            if(chord!=targetChord) {
                for(int i=0;i<3;i++)targets[i]=220*Math.pow(2,(CHORDS[chord][i]+transpose)/12.0);
                targetChord=chord;
            }
            wowPhase=wrap(wowPhase+TAU*.19/sampleRate);
            double wow=Math.sin(wowPhase)*(styles[5]*8+styles[4]*3)*.000578;
            double left=0,right=0,weight=.13*(1-.3*styles[2]-.12*styles[3]);
            for(int v=0;v<3;v++) {
                frequencies[v]=ease(frequencies[v],targets[v]);
                double increment=TAU*frequencies[v]/sampleRate;
                phaseL[v]=wrap(phaseL[v]+increment*(1-detune*.00026+wow));
                phaseR[v]=wrap(phaseR[v]+increment*(1+detune*.00026+wow));
                left+=weight*wave(phaseL[v]);right+=weight*wave(phaseR[v]);
            }
            amPhase=wrap(amPhase+TAU*rate/sampleRate);
            double modulation=1-intensity*.5+intensity*.5*Math.sin(amPhase);
            left*=modulation*musicVolume;right*=modulation*musicVolume;
            bassPhase=wrap(bassPhase+TAU*frequencies[0]/(4*sampleRate));
            double bass=(.12+.06*styles[2])*Math.sin(bassPhase)*bassVolume*2;
            notePhase=wrap(notePhase+TAU*frequencies[2]*1.5/sampleRate);noteBeat=wrap(noteBeat+cadence/sampleRate);
            double window=Math.max(0,Math.sin(noteBeat)),square=window*window;
            double note=.045*(1-styles[2]*.6)*square*square*square*wave(notePhase)*melodyVolume*2*modulation;
            double noise=random()*2-1;
            brown=.997*brown+.035*noise;slow=.98*slow+.02*noise;midNoise=.85*midNoise+.15*noise;fast=.5*fast+.5*noise;
            double pink=slow*2.5+midNoise*.8+fast*.3+noise*.08;
            crackle*=.985;if(random()<.0007)crackle=.3+random()*.7;
            double ocean=Math.sin(seconds*Math.PI/8),wind=Math.sin(seconds*Math.PI/4);
            double air=textures[0]*(noise*.45+fast*.2)+textures[1]*brown*2.5+textures[2]*pink+
                textures[3]*pink*(.25+.75*ocean*ocean)+textures[4]*(midNoise-slow)*1.8*(.4+.6*wind*wind)+textures[5]*(brown*.4+noise*crackle);
            ambienceFiltered+=.5*(ambienceVolume*.24*Math.tanh(air)-ambienceFiltered);
            double ambience=ambienceFiltered;
            double lofi=musicVolume*styles[1]*.025*fast;
            filteredL+=filterAlpha*(left+note+lofi-filteredL);filteredR+=filterAlpha*(right+note+lofi-filteredR);
            left=filteredL+bass;right=filteredR+bass;
            double tailL=delayL[delayIndexL],tailR=delayR[delayIndexR];
            delayL[delayIndexL]=left+tailR*.35;delayR[delayIndexR]=right+tailL*.35;
            if(++delayIndexL==delayL.length)delayIndexL=0;if(++delayIndexR==delayR.length)delayIndexR=0;
            left+=space*.32*tailL+ambience;right+=space*.32*tailR+ambience;
            double mid=(left+right)*.5,side=(left-right)*.5*stereo,gain=volume*envelope*.8;
            output[n*2]=gain==0?0:(float)(Math.tanh(mid+side)*gain);
            output[n*2+1]=gain==0?0:(float)(Math.tanh(mid-side)*gain);
        }
    }
}

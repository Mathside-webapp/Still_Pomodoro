from pathlib import Path
import math, wave, numpy as np
from PIL import Image,ImageDraw
root=Path(__file__).parent
raw=root/'native-assets/android/app/src/main/res/raw';raw.mkdir(parents=True,exist_ok=True)
FS=22050
patterns={
 'gentle':[(0,523.25,.75,'sine'),(.30,659.25,.85,'sine'),(.62,783.99,1.05,'sine')],
 'bell':[(0,784,1.35,'sine'),(.55,523.25,1.45,'sine'),(1.10,784,.9,'sine')],
 'marimba':[(i*.2,f,.35,'triangle') for i,f in enumerate([523.25,659.25,783.99,659.25,523.25])],
 'digital':[(i*.25,f,.22,'square') for i,f in enumerate([880,1320,1760])],
 'sunrise':[(i*.22,f,.55,'sine') for i,f in enumerate([392,493.88,587.33,783.99,987.77])],
 'crystal':[(i*.23,f,.85,'sine') for i,f in enumerate([1174.66,987.77,783.99,587.33,783.99])],
 'classic':[(i*.23,659.25 if i%2 else 880,.18,'square') for i in range(6)],
 'ocean':[(i*.36,f,.9,'sine') for i,f in enumerate([392,349.23,329.63,293.66,261.63])],
 'retro':[(i*.2,f,.14,'square') for i,f in enumerate([523.25,784,523.25,1046.5,784])],
 'celebrate':[(i*.16,f,.42,'triangle') for i,f in enumerate([523.25,659.25,783.99,1046.5,783.99,1046.5])]
}
for name, notes in patterns.items():
 length=max(start+dur for start, freq,dur,waveform in notes)+.20
 y=np.zeros(int(length*FS),dtype=np.float64)
 for start,freq,dur,waveform in notes:
  n=int(dur*FS);t=np.arange(n)/FS
  phase=2*np.pi*freq*t
  if waveform=='square':base=np.tanh(3*np.sin(phase))*0.34
  elif waveform=='triangle':base=(2/np.pi)*np.arcsin(np.sin(phase))*.75
  else:base=np.sin(phase)
  if name in ('bell','crystal','gentle'):
   base=0.76*base + 0.18*np.sin(phase*2.01)
  envelope=np.minimum(1,t/.025)*np.minimum(1,(dur-t)/.20)
  envelope=np.maximum(0,envelope)**1.4
  i=int(start*FS);y[i:i+n]+=base*envelope*.15
 y=np.tanh(y*.9)
 pcm=(y*32767).astype('<i2')
 with wave.open(str(raw/f'still_{name}.wav'),'wb') as wf:
  wf.setnchannels(1);wf.setsampwidth(2);wf.setframerate(FS);wf.writeframes(pcm.tobytes())
# Android launcher resources, all opaque for easy compatibility.
icon=Image.open(root/'icon-512.png').convert('RGBA')
for qual,pixels in [('mdpi',48),('hdpi',72),('xhdpi',96),('xxhdpi',144),('xxxhdpi',192)]:
 dest=root/f'native-assets/android/app/src/main/res/mipmap-{qual}'
 dest.mkdir(parents=True,exist_ok=True)
 img=icon.resize((pixels,pixels),Image.Resampling.LANCZOS)
 img.save(dest/'ic_launcher.png')
 img.save(dest/'ic_launcher_round.png')
# A monochrome, alpha-only notification icon (Android tints to desired color).
size=96
notif=Image.new('RGBA',(size,size),(0,0,0,0));d=ImageDraw.Draw(notif)
# Still icon: three diagonals in white, angled and centered.
for shift in [-20,0,20]:
 x=48+shift
 d.line([(x-13,23),(x+13,73)],fill=(255,255,255,255),width=10)
for qual,pixels in [('mdpi',24),('hdpi',36),('xhdpi',48),('xxhdpi',72),('xxxhdpi',96)]:
 dest=root/f'native-assets/android/app/src/main/res/drawable-{qual}'
 dest.mkdir(parents=True,exist_ok=True)
 notif.resize((pixels,pixels),Image.Resampling.LANCZOS).save(dest/'ic_still_notification.png')
print('Generated',len(patterns),'offline Android notification WAV sounds and launcher/status icons')

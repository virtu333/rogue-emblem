import numpy as np
from PIL import Image, ImageFilter
from scipy.cluster.vq import kmeans2
import sys, os

BAYER4 = (np.array([[0,8,2,10],[12,4,14,6],[3,11,1,9],[15,7,13,5]])+0.5)/16.0
INK = np.array([14,12,20],float)

def q12(c):  # PC-98: 4 bits per channel (4096 colours)
    return np.round(np.clip(c,0,255)/17.0)*17.0

def pc98(src, size=160, k=15, bg_top=(26,22,36), bg_bot=(58,24,40), seed=1):
    im = Image.open(src).convert('RGBA')
    im = im.resize((size,size), Image.LANCZOS)
    a = np.asarray(im).astype(float)
    rgb, alpha = a[...,:3], a[...,3]/255.0
    # background: vertical two-tone, to be dithered like the figure
    yy = np.linspace(0,1,size)[:,None,None]
    bg = np.array(bg_top)[None,None,:]*(1-yy) + np.array(bg_bot)[None,None,:]*yy
    comp = rgb*alpha[...,None] + bg*(1-alpha[...,None])
    # palette: k-means over figure pixels, quantized to 12-bit, plus ink + bg tones
    fig = comp[alpha>0.5].reshape(-1,3)
    np.random.seed(seed)
    cent,_ = kmeans2(fig, k, minit='++', seed=seed)
    pal = np.unique(q12(np.vstack([cent, q12(np.array(bg_top)), q12(np.array(bg_bot)), INK])), axis=0)
    # ordered dither between two nearest palette colours
    flat = comp.reshape(-1,3)
    d = ((flat[:,None,:]-pal[None,:,:])**2).sum(-1)
    idx = np.argsort(d,1)[:,:2]
    c1, c2 = pal[idx[:,0]], pal[idx[:,1]]
    v = c2-c1; t = ((flat-c1)*v).sum(1)/np.maximum((v*v).sum(1),1e-6)
    t = np.clip(t,0,1)
    # only dither between near colours (avoid noisy cross-hue speckle)
    near = np.sqrt((v*v).sum(1)) < 70
    th = np.tile(BAYER4,(size//4+1,size//4+1))[:size,:size].reshape(-1)
    choose2 = (t > th) & near
    out = np.where(choose2[:,None], c2, c1).reshape(size,size,3)
    # line art: darken strong luminance edges on the figure silhouette + interior
    lum = comp.mean(-1)
    gx = np.abs(np.diff(lum,axis=1,prepend=lum[:,:1])); gy = np.abs(np.diff(lum,axis=0,prepend=lum[:1]))
    edge = (np.maximum(gx,gy) > 34) & (lum < 110)
    # silhouette outline
    m = alpha>0.5
    sil = m & ~(np.roll(m,1,0)&np.roll(m,-1,0)&np.roll(m,1,1)&np.roll(m,-1,1))
    out[edge|sil] = INK
    return Image.fromarray(out.astype(np.uint8))

if __name__=='__main__':
    names = sys.argv[2:]; base=sys.argv[1]
    tiles=[]
    for n in names:
        p = os.path.join(base, n+'.png')
        before = Image.open(p).convert('RGBA').resize((160,160),Image.LANCZOS)
        bgc = Image.new('RGBA',(160,160),(26,22,36,255)); bgc.alpha_composite(before)
        after = pc98(p)
        tiles.append((bgc.convert('RGB'), after))
    W=160*3; sheet=Image.new('RGB',(W*len(tiles)//len(tiles)*len(tiles) if False else 320*len(tiles), 160*3),(10,9,14))
    for i,(b,a) in enumerate(tiles):
        sheet.paste(b.resize((320,320),Image.NEAREST).crop((0,0,320,320)).resize((160,160),Image.LANCZOS),(i*320,0))
        sheet.paste(a.resize((320,320),Image.NEAREST),(i*320,160))
    sheet.save('pc98_sheet.png'); print('ok')

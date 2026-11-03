/** Synthetic canvas camera: a blank room, a covered lens and two sides of one striped garment. */
export const guidedCameraFixture = `
(() => {
  const canvas=document.createElement('canvas');canvas.width=640;canvas.height=480;
  const ctx=canvas.getContext('2d');let mode='room';
  globalThis.evaScene=(next)=>{mode=next};
  const paint=()=>{
    ctx.fillStyle=mode==='black'?'#000':'#e8e2d8';ctx.fillRect(0,0,640,480);
    if(mode==='front'||mode==='back'){
      ctx.fillStyle=mode==='front'?'#b23032':'#143655';
      ctx.beginPath();ctx.moveTo(245,80);ctx.lineTo(185,105);ctx.lineTo(155,185);ctx.lineTo(215,210);ctx.lineTo(235,175);ctx.lineTo(230,405);ctx.lineTo(410,405);ctx.lineTo(405,175);ctx.lineTo(425,210);ctx.lineTo(485,185);ctx.lineTo(455,105);ctx.lineTo(395,80);ctx.lineTo(365,110);ctx.lineTo(275,110);ctx.closePath();ctx.fill();
      ctx.strokeStyle='#eec8b8';ctx.lineWidth=4;for(let y=140;y<390;y+=22){ctx.beginPath();ctx.moveTo(245,y);ctx.lineTo(395,y);ctx.stroke()}
    }
  };paint();setInterval(paint,80);
  Object.defineProperty(navigator.mediaDevices,'getUserMedia',{value:async()=>canvas.captureStream(12)});
})();`

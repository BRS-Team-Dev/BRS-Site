import{a as f}from"./chunk-3WQPIISQ.js";var m=794,g=1123,u=595.28,h=841.89,y="Arial, Helvetica, sans-serif";async function T(t,e={}){let o=document.createElement("div");o.style.cssText=`
    position: absolute; left: -10000px; top: 0;
    width: ${m}px;
    background: #ffffff;
    z-index: -1;
  `,document.body.appendChild(o);let i=[];try{let n=t.length;t.forEach((a,d)=>{let p=P(a,d,n,e);o.appendChild(p),i.push(p)}),await C(o),await new Promise(a=>requestAnimationFrame(()=>a(null)));let[{default:s},c]=await Promise.all([import("./chunk-IY7MJBPW.js"),import("./chunk-N4P3L6ZB.js")]),l=c.jsPDF??c.default,r=new l({unit:"pt",format:"a4",orientation:"portrait"});for(let a=0;a<i.length;a++){let p=(await s(i[a],{scale:2,backgroundColor:"#ffffff",useCORS:!0,logging:!1,windowWidth:m})).toDataURL("image/jpeg",.95);a>0&&r.addPage("a4","portrait"),r.addImage(p,"JPEG",0,0,u,h)}return r.output("blob")}finally{document.body.removeChild(o)}}function P(t,e,o,i){let n=document.createElement("section");n.style.cssText=`
    width: ${m}px; height: ${g}px;
    padding: 64px 56px 120px;
    background: #ffffff; color: #111;
    font-family: ${y}; font-size: 13px; line-height: 1.55;
    position: relative;
    box-sizing: border-box;
    overflow: hidden;
  `,t.blocks.forEach(d=>n.appendChild(b(d)));let s=document.createElement("div");s.style.cssText=`
    position: absolute; left: 56px; right: 56px; bottom: 56px;
    display: flex; gap: 24px; align-items: flex-start;
  `;let c=i.signedAt||(i.signatureDataUrl?new Date().toISOString().slice(0,10):"");s.appendChild(x({flex:"1",image:i.signatureDataUrl,label:"Signature",caption:i.signerName})),s.appendChild(x({flex:"0 0 200px",text:c,label:"Date"})),n.appendChild(s);let l=document.createElement("div");l.style.cssText=`
    position: absolute; left: 56px; right: 56px; bottom: 24px;
    font-size: 10px; color: #777;
    display: flex; justify-content: space-between;
  `;let r=document.createElement("span");r.textContent=i.title||"Document";let a=document.createElement("span");return a.textContent=`Page ${e+1} of ${o}`,l.appendChild(r),l.appendChild(a),n.appendChild(l),n}function x(t){let e=document.createElement("div");e.style.cssText=`flex: ${t.flex}; display: flex; flex-direction: column; gap: 4px;`;let o=document.createElement("div");if(o.style.cssText=`
    height: 56px;
    display: flex; align-items: flex-end; justify-content: flex-start;
    border-bottom: 1px solid #111;
    padding: 0 4px 4px;
  `,t.image){let n=document.createElement("img");n.src=t.image,n.style.cssText="max-height: 52px; max-width: 100%; object-fit: contain; display: block;",o.appendChild(n)}else if(t.text){let n=document.createElement("span");n.style.cssText="font-size: 12px; color: #111; line-height: 1;",n.textContent=t.text,o.appendChild(n)}e.appendChild(o);let i=document.createElement("div");if(i.style.cssText="font-size: 10px; color: #555; padding: 0 4px;",i.textContent=t.label,e.appendChild(i),t.caption){let n=document.createElement("div");n.style.cssText="font-size: 11px; color: #111; padding: 0 4px;",n.textContent=t.caption,e.appendChild(n)}return e}function b(t){if(t.kind==="heading"){let e=t.level??2,o=document.createElement("h"+e),i={1:"26px",2:"20px",3:"16px"},n={1:"0 0 12px",2:"14px 0 8px",3:"12px 0 6px"};return o.style.cssText=`font-size: ${i[e]}; margin: ${n[e]}; font-weight: 700; color: #111;`,o.textContent=t.body||"",o}if(t.kind==="text"){let e=document.createElement("p");return e.style.cssText="margin: 0 0 10px; white-space: pre-wrap; color: #111;",e.textContent=t.body||"",e}if(t.kind==="image"&&t.url){let e=document.createElement("img");return e.style.cssText="max-width: 100%; height: auto; margin: 6px 0; display: block;",e.src=`${f.basePath}/`+t.url.replace(/^\//,""),e.alt=t.alt||"",e.crossOrigin="anonymous",e}if(t.kind==="spacer"){let e=document.createElement("div");return e.style.cssText="height: 24px;",e}return document.createElement("span")}function C(t){let e=Array.from(t.querySelectorAll("img"));return e.length===0?Promise.resolve():Promise.all(e.map(o=>o.complete?Promise.resolve():new Promise(i=>{o.onload=o.onerror=()=>i()}))).then(()=>{})}export{T as a};

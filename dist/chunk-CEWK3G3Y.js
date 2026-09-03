import{a as Se}from"./chunk-SO4GY6KK.js";import{a as Pe}from"./chunk-BPXR4LSR.js";import{a as be}from"./chunk-HNHWTVQT.js";import{b as fe,c as he,f as Ce,h as we,k as ye,l as Me,m as Te,o as Ie,s as ke}from"./chunk-M2FU52KD.js";import{g as xe}from"./chunk-2KLM6TX6.js";import{Fb as ge,Gb as G,Ha as d,Ib as s,Jb as P,Kb as D,Lb as ve,N as Q,Ob as F,Pb as E,Qb as V,U as p,Ua as me,Ub as A,V as m,aa as ue,cb as B,db as C,eb as w,fa as M,hb as K,ia as pe,ib as Z,jb as y,kb as l,lb as o,mb as N,rb as S,vb as v,xb as c}from"./chunk-EK3XRYGO.js";import{a as ce,b as _e}from"./chunk-KAT7YFEL.js";var Fe=(r,e)=>e.id,Le=(r,e)=>e.client_service_offering_id;function Oe(r,e){if(r&1&&(l(0,"span",4),s(1),o()),r&2){let i=e,n=c(2);B("data-inv-status",i),d(),D(" ",n.statusLabel(i)," ")}}function Be(r,e){r&1&&(l(0,"p",7),s(1,"Loading\u2026"),o())}function ze(r,e){r&1&&(l(0,"p",18),s(1,"No services attached to this invoice."),o())}function $e(r,e){if(r&1&&s(0),r&2){let i=c().$implicit;D(" / ",i.repeat_duration," ")}}function Ne(r,e){if(r&1){let i=S();l(0,"li")(1,"span"),s(2),o(),l(3,"span",18),s(4),C(5,$e,1,1),o(),l(6,"button",38),v("click",function(){let t=p(i).$implicit,a=c(4);return m(a.detachService(t.client_service_offering_id))}),s(7,"\u2715"),o()()}if(r&2){let i=e.$implicit,n=c(4);d(2),P(i.name),d(2),D(" ",n.formatMoney(i.price)," "),d(),w(i.payment_type==="recurring"&&i.repeat_duration?5:-1)}}function Ge(r,e){if(r&1&&(l(0,"ul",19),K(1,Ne,8,3,"li",null,Le),o()),r&2){let i=c();d(),Z(i.services)}}function Ae(r,e){if(r&1){let i=S();l(0,"tr")(1,"td")(2,"input",39),V("ngModelChange",function(t){let a=p(i).$implicit;return E(a.description,t)||(a.description=t),m(t)}),v("change",function(){let t=p(i).$implicit,a=c(3);return m(a.saveLine(t))}),o()(),l(3,"td")(4,"input",40),V("ngModelChange",function(t){let a=p(i).$implicit;return E(a.quantity,t)||(a.quantity=t),m(t)}),v("change",function(){let t=p(i).$implicit,a=c(3);return m(a.saveLine(t))}),o()(),l(5,"td")(6,"input",40),V("ngModelChange",function(t){let a=p(i).$implicit;return E(a.unit_price,t)||(a.unit_price=t),m(t)}),v("change",function(){let t=p(i).$implicit,a=c(3);return m(a.saveLine(t))}),o()(),l(7,"td")(8,"input",40),V("ngModelChange",function(t){let a=p(i).$implicit;return E(a.tax_rate,t)||(a.tax_rate=t),m(t)}),v("change",function(){let t=p(i).$implicit,a=c(3);return m(a.saveLine(t))}),o()(),l(9,"td"),s(10),o(),l(11,"td")(12,"button",41),v("click",function(){let t=p(i).$implicit,a=c(3);return m(a.removeLine(t.id))}),s(13,"\u2715"),o()()()}if(r&2){let i=e.$implicit,n=c(3);d(2),y("name",A("ld_",i.id)),F("ngModel",i.description),d(2),y("name",A("lq_",i.id)),F("ngModel",i.quantity),d(2),y("name",A("lu_",i.id)),F("ngModel",i.unit_price),d(2),y("name",A("lt_",i.id)),F("ngModel",i.tax_rate),d(2),P(n.formatMoney(i.line_total))}}function We(r,e){if(r&1&&(l(0,"option",44),s(1),o()),r&2){let i=e.$implicit;y("ngValue",i.id),d(),ve(" ",i.name,"",i.is_default?" \u2014 default":""," ")}}function He(r,e){if(r&1){let i=S();l(0,"label",27)(1,"span",42),s(2,"Template"),o(),l(3,"select",43),v("ngModelChange",function(t){p(i);let a=c(3);return m(a.pickedTemplateId.set(t?+t:null))}),l(4,"option",44),s(5,"Built-in (Modern)"),o(),K(6,We,2,3,"option",44,Fe),o()()}if(r&2){let i=c(3);d(3),y("ngModel",i.pickedTemplateId()),d(),y("ngValue",null),d(2),Z(i.templates())}}function Re(r,e){r&1&&(l(0,"span",18),s(1),o()),r&2&&(d(),D("Sent to ",e))}function Ue(r,e){if(r&1){let i=S();l(0,"span",46)(1,"span",50),s(2,"\xA3"),o(),l(3,"input",51),v("ngModelChange",function(t){p(i);let a=c(4);return m(a.paidDraft.set(t))})("change",function(){p(i);let t=c(4);return m(t.savePaid())}),o()()}if(r&2){let i=c(4);d(3),y("ngModel",i.paidDraft())}}function je(r,e){if(r&1&&(l(0,"span",34),s(1),o()),r&2){let i=c(2),n=c(2);d(),P(n.formatMoney(i.invoice.amount_paid))}}function qe(r,e){if(r&1&&(N(0,"div",35),l(1,"div",45)(2,"span",33),s(3,"Paid"),o(),C(4,Ue,4,1,"span",46)(5,je,2,1,"span",34),o(),l(6,"div",47)(7,"span",33),s(8,"Balance"),o(),l(9,"span",34),s(10),o()(),l(11,"div",48),N(12,"div",49),o()),r&2){let i=c(),n=c(2);d(4),w(i.invoice.status==="part_paid"?4:5),d(2),G("zero",n.remainingBalance()===0),d(4),P(n.formatMoney(n.remainingBalance())),d(),y("title","Paid "+n.formatMoney(i.invoice.amount_paid)+" of "+n.formatMoney(i.invoice.total)),d(),ge("width",n.paidPct(),"%")}}function Ye(r,e){if(r&1&&(l(0,"div",37),s(1),o()),r&2){let i=c(3);d(),P(i.error())}}function Xe(r,e){if(r&1){let i=S();l(0,"div",12)(1,"div")(2,"label"),s(3,"Bill to"),o(),l(4,"input",13),V("ngModelChange",function(t){p(i);let a=c(2);return E(a.draft.bill_to_name,t)||(a.draft.bill_to_name=t),m(t)}),v("change",function(){p(i);let t=c(2);return m(t.saveHeader())}),o()(),l(5,"div")(6,"label"),s(7,"Email"),o(),l(8,"input",14),V("ngModelChange",function(t){p(i);let a=c(2);return E(a.draft.bill_to_email,t)||(a.draft.bill_to_email=t),m(t)}),v("change",function(){p(i);let t=c(2);return m(t.saveHeader())}),o()()(),l(9,"div",12)(10,"div")(11,"label"),s(12,"Issue date"),o(),l(13,"input",15),V("ngModelChange",function(t){p(i);let a=c(2);return E(a.draft.issue_date,t)||(a.draft.issue_date=t),m(t)}),v("change",function(){p(i);let t=c(2);return m(t.saveHeader())}),o()(),l(14,"div")(15,"label"),s(16,"Due date"),o(),l(17,"input",16),V("ngModelChange",function(t){p(i);let a=c(2);return E(a.draft.due_date,t)||(a.draft.due_date=t),m(t)}),v("change",function(){p(i);let t=c(2);return m(t.saveHeader())}),o()()(),l(18,"label",17),s(19,"Services billed"),o(),C(20,ze,2,0,"p",18)(21,Ge,3,0,"ul",19),l(22,"label",17),s(23,"Line items"),o(),l(24,"table",20)(25,"thead")(26,"tr")(27,"th"),s(28,"Description"),o(),l(29,"th",21),s(30,"Qty"),o(),l(31,"th",22),s(32,"Unit \xA3"),o(),l(33,"th",21),s(34,"Tax %"),o(),l(35,"th",22),s(36,"Total"),o(),N(37,"th",23),o()(),l(38,"tbody"),K(39,Ae,14,13,"tr",null,Fe),o()(),l(41,"button",24),v("click",function(){p(i);let t=c(2);return m(t.addLine())}),s(42," + Add line "),o(),l(43,"div",25)(44,"div",26),C(45,He,8,2,"label",27),l(46,"button",28),v("click",function(){p(i);let t=c(2);return m(t.viewPdf())}),l(47,"span",29),s(48,"\u{1F441}"),o(),s(49),o(),l(50,"button",28),v("click",function(){p(i);let t=c(2);return m(t.downloadPdf())}),l(51,"span",29),s(52,"\u2B07"),o(),s(53),o(),l(54,"button",30),v("click",function(){p(i);let t=c(2);return m(t.sendEmail())}),l(55,"span",29),s(56,"\u2709"),o(),s(57),o(),C(58,Re,2,1,"span",18),o(),l(59,"div",31)(60,"div",32)(61,"span",33),s(62,"Subtotal"),o(),l(63,"span",34),s(64),o()(),l(65,"div",32)(66,"span",33),s(67,"Tax"),o(),l(68,"span",34),s(69),o()(),N(70,"div",35),l(71,"div",36)(72,"span",33),s(73,"Total"),o(),l(74,"span",34),s(75),o()(),C(76,qe,13,7),o()(),C(77,Ye,2,1,"div",37)}if(r&2){let i,n=e,t=c(2);d(4),F("ngModel",t.draft.bill_to_name),d(4),F("ngModel",t.draft.bill_to_email),d(5),F("ngModel",t.draft.issue_date),d(4),F("ngModel",t.draft.due_date),d(3),w(n.services.length===0?20:21),d(19),Z(t.lines()),d(6),w(t.templates().length>0?45:-1),d(),y("disabled",t.pdfBusy()),d(3),D(" ",t.pdfBusy()?"Preparing\u2026":"View PDF"," "),d(),y("disabled",t.pdfBusy()),d(3),D(" ",t.pdfBusy()?"Preparing\u2026":"Download PDF"," "),d(),y("disabled",t.emailBusy()||!n.invoice.bill_to_email)("title",n.invoice.bill_to_email?"Send to "+n.invoice.bill_to_email:"Set bill_to_email first"),d(3),D(" ",t.emailBusy()?"Sending\u2026":"Send email"," "),d(),w((i=t.emailSentTo())?58:-1,i),d(6),P(t.formatMoney(n.invoice.subtotal)),d(5),P(t.formatMoney(n.invoice.tax_total)),d(6),P(t.formatMoney(n.invoice.total)),d(),w(n.invoice.status==="part_paid"||n.invoice.status==="paid"?76:-1),d(),w(t.error()?77:-1)}}function Qe(r,e){if(r&1){let i=S();l(0,"button",52),s(1,"Draft"),o(),l(2,"button",53),v("click",function(){p(i);let t=c(2);return m(t.markSent())}),s(3,"Mark sent"),o()}r&2&&B("data-inv-status","draft")}function Ke(r,e){if(r&1){let i=S();l(0,"button",53),v("click",function(){p(i);let t=c(3);return m(t.markSent())}),s(1,"Not paid"),o(),l(2,"button",53),v("click",function(){p(i);let t=c(3);return m(t.markPartPaid())}),s(3,"Part paid"),o(),l(4,"button",53),v("click",function(){p(i);let t=c(3);return m(t.markPaid())}),s(5,"Paid"),o()}if(r&2){let i,n,t,a=c(3);G("current",((i=a.detail())==null||i.invoice==null?null:i.invoice.status)==="sent"),B("data-inv-status","sent"),d(2),G("current",((n=a.detail())==null||n.invoice==null?null:n.invoice.status)==="part_paid"),B("data-inv-status","part_paid"),d(2),G("current",((t=a.detail())==null||t.invoice==null?null:t.invoice.status)==="paid"),B("data-inv-status","paid")}}function Ze(r,e){if(r&1&&C(0,Ke,6,9),r&2){let i,n=c(2);w(((i=n.detail())==null||i.invoice==null?null:i.invoice.status)!=="void"?0:-1)}}function Je(r,e){if(r&1){let i=S();l(0,"div",1),v("click",function(){p(i);let t=c();return m(t.close())}),l(1,"div",2),v("click",function(t){return t.stopPropagation()}),l(2,"div",3)(3,"h3"),s(4),C(5,Oe,2,2,"span",4),o(),l(6,"button",5),v("click",function(){p(i);let t=c();return m(t.close())}),s(7,"\u2715"),o()(),l(8,"div",6),C(9,Be,2,0,"p",7)(10,Xe,78,19),o(),l(11,"div",8)(12,"div",9)(13,"span",10),s(14,"Status"),o(),C(15,Qe,4,1)(16,Ze,1,1),o(),l(17,"button",11),v("click",function(){p(i);let t=c();return m(t.close())}),s(18,"Done"),o()()()()}if(r&2){let i,n,t,a,g=c();d(4),D(" ",((i=g.detail())==null||i.invoice==null?null:i.invoice.invoice_number)||"Invoice"," "),d(),w((n=(n=g.detail())==null||n.invoice==null?null:n.invoice.status)?5:-1,n),d(4),w(g.loading()?9:(t=g.detail())?10:-1,t),d(6),w(((a=g.detail())==null||a.invoice==null?null:a.invoice.status)==="draft"?15:16)}}var De=class r{api=Q(be);dialog=Q(Se);settingsSvc=Q(Pe);constructor(){this.settingsSvc.ensureLoaded(),this.ensureTemplatesLoaded()}ensureTemplatesLoaded(){this.templatesLoaded||(this.templatesLoaded=!0,this.api.listInvoiceTemplates().subscribe({next:e=>{let i=e.templates||[];this.templates.set(i);let n=i.find(t=>t.is_default);n?.id&&this.pickedTemplateId.set(n.id)},error:()=>this.templates.set([])}))}branding(){let e=this.settingsSvc.settings()??{},i=t=>e[t]||"",n=i("invoice.signature_font");return{business_name:i("invoice.business_name"),business_address:i("invoice.business_address"),business_email:i("invoice.business_email"),business_phone:i("invoice.business_phone"),business_website:i("invoice.business_website"),bank_name:i("invoice.bank_name"),bank_account_name:i("invoice.bank_account_name"),bank_account_number:i("invoice.bank_account_number"),bank_sort_code:i("invoice.bank_sort_code"),show_bank_details:i("invoice.show_bank_details")!=="0",signature_name:i("invoice.signature_name"),signature_font:n||"italic",tax_label:i("invoice.tax_label")||"Tax",logo_url:i("invoice.logo_url")||i("brand_logo_url")}}async fetchImageAsDataUrl(e){if(!e)return null;let i=n=>new Promise(t=>{let a=new FileReader;a.onload=()=>t(String(a.result||"")||null),a.onerror=()=>t(null),a.readAsDataURL(n)});try{if(new URL(e,window.location.href).origin===window.location.origin){let g=await fetch(e,{credentials:"include"});return g.ok?await i(await g.blob()):null}let a=await new Promise(g=>{this.api.fetchLogoBlob(e).subscribe({next:b=>g(b),error:()=>g(null)})});return a?await i(a):null}catch{return null}}pdfBusy=M(!1);emailBusy=M(!1);emailSentTo=M(null);templates=M([]);pickedTemplateId=M(null);templatesLoaded=!1;invoiceId=null;closed=new ue;open=M(!1);loading=M(!1);error=M(null);detail=M(null);lines=M([]);paidDraft=M(null);draft={bill_to_name:"",bill_to_email:null,issue_date:"",due_date:null};ngOnChanges(e){if("invoiceId"in e){let i=this.invoiceId;i!=null?(this.open.set(!0),this.load(i)):this.open.set(!1)}}statusLabel(e){switch(e){case"draft":return"Draft";case"sent":return"Not paid";case"part_paid":return"Part paid";case"paid":return"Paid";case"void":return"Void";default:return String(e??"")}}formatMoney(e){if(e==null||e==="")return"\u2014";let i=typeof e=="number"?e:Number(e);return Number.isFinite(i)?i.toLocaleString(void 0,{style:"currency",currency:"GBP"}):"\u2014"}remainingBalance(){let e=this.detail()?.invoice;if(!e)return 0;let i=Number(e.total??0),n=Number(e.amount_paid??0),t=i-n;return t>0?t:0}paidPct(){let e=this.detail()?.invoice;if(!e)return 0;let i=Number(e.total??0),n=Number(e.amount_paid??0);if(!Number.isFinite(i)||i<=0)return n>0?100:0;let t=n/i*100;return t<0?0:t>100?100:t}close(){this.open.set(!1),this.detail.set(null),this.lines.set([]),this.error.set(null),this.emailSentTo.set(null),this.closed.emit()}load(e){this.loading.set(!0),this.error.set(null),this.emailSentTo.set(null),this.api.getInvoice(e).subscribe({next:i=>this.applyDetail(i),error:i=>{this.loading.set(!1),this.error.set(i?.error?.error||"Load failed")}})}applyDetail(e){this.detail.set({invoice:e.invoice,services:e.services||[]}),this.lines.set((e.lines||[]).map(i=>_e(ce({},i),{quantity:i.quantity==null?1:Number(i.quantity),unit_price:i.unit_price==null?0:Number(i.unit_price),tax_rate:i.tax_rate==null?0:Number(i.tax_rate)}))),this.draft={bill_to_name:e.invoice.bill_to_name||"",bill_to_email:e.invoice.bill_to_email||null,issue_date:e.invoice.issue_date||"",due_date:e.invoice.due_date||null},this.paidDraft.set(e.invoice.amount_paid===null||e.invoice.amount_paid===void 0?null:Number(e.invoice.amount_paid)),this.loading.set(!1)}reload(){let e=this.detail()?.invoice?.id;e&&this.load(e)}saveHeader(){let e=this.detail()?.invoice?.id;e&&this.api.updateInvoice(e,{bill_to_name:this.draft.bill_to_name,bill_to_email:this.draft.bill_to_email,issue_date:this.draft.issue_date,due_date:this.draft.due_date}).subscribe({error:i=>this.error.set(i?.error?.error||"Save failed")})}saveLine(e){let i=this.detail()?.invoice?.id;!i||!e.id||this.api.updateInvoiceLine(i,e.id,{description:e.description,quantity:Number(e.quantity),unit_price:Number(e.unit_price),tax_rate:Number(e.tax_rate)}).subscribe({next:()=>this.reload(),error:n=>this.error.set(n?.error?.error||"Line save failed")})}addLine(){let e=this.detail()?.invoice?.id;e&&this.api.addInvoiceLine(e,{description:"New line",quantity:1,unit_price:0,tax_rate:0}).subscribe({next:()=>this.reload()})}removeLine(e){let i=this.detail()?.invoice?.id;i&&this.api.deleteInvoiceLine(i,e).subscribe({next:()=>this.reload()})}detachService(e){let i=this.detail()?.invoice?.id;i&&this.api.detachInvoiceService(i,e).subscribe({next:()=>this.reload()})}async downloadPdf(){let e=this.detail();if(!e||this.pdfBusy())return;let i=this.pickedTemplateId();if(i!=null){this.pdfBusy.set(!0),this.api.renderInvoiceTemplate(i,e.invoice.id).subscribe({next:n=>{this.pdfBusy.set(!1),this.openRenderedHtml(n.html,n.invoice_number,!0)},error:n=>{this.pdfBusy.set(!1),this.dialog.alert(n?.error?.error||"Template render failed.",{title:"PDF error",variant:"danger"})}});return}this.pdfBusy.set(!0);try{let{jsPDF:n}=await import("./chunk-SI5IKR5N.js"),t=this.branding(),a=await this.fetchImageAsDataUrl(t.logo_url),g=this.drawInvoicePdf(new n({unit:"mm",format:"a4"}),e.invoice,this.lines(),t,a),b=W=>(W||"").replace(/[^A-Za-z0-9_-]+/g,"_");g.save(`invoice-${b(e.invoice.invoice_number)}.pdf`)}catch(n){console.error(n),this.dialog.alert("PDF generation failed.",{title:"PDF error",variant:"danger"})}finally{this.pdfBusy.set(!1)}}openRenderedHtml(e,i,n){let t=`<!doctype html><html><head>
<meta charset="utf-8" />
<title>Invoice ${i}</title>
<style>
  body { margin: 0; font-family: Arial, sans-serif; background: #f4f4f4; }
  .toolbar { position: sticky; top: 0; z-index: 999;
             background: #111; color: #fff; padding: 10px 20px;
             display: flex; align-items: center; gap: 12px; }
  .toolbar button { background: #d4a93a; color: #111; border: 0;
                    padding: 8px 16px; border-radius: 4px; cursor: pointer;
                    font-weight: 600; }
  .toolbar .hint { color: #aaa; font-size: 13px; }
  @media print { .toolbar { display: none; } body { background: #fff; } @page { size: A4; margin: 0; } }
</style>
</head><body>
<div class="toolbar">
  <button onclick="window.print()">Print / Save as PDF</button>
  <span class="hint">Ctrl+P also opens the print dialog.</span>
</div>
${e}
${n?"<script>setTimeout(() => window.print(), 500);<\/script>":""}
</body></html>`,a=window.open("","_blank");if(!a){let g="data:text/html;charset=utf-8,"+encodeURIComponent(t);window.location.href=g;return}a.document.open(),a.document.write(t),a.document.close()}drawInvoicePdf(e,i,n,t,a=null){let g=u=>{if(u==null||u==="")return"-";let x=typeof u=="number"?u:Number(u);return Number.isFinite(x)?"GBP "+x.toFixed(2):"-"},b=u=>u==null?"":String(u),H=[212,169,58],f=[40,40,40],k=[110,110,110],O=[40,40,40];e.setFont("helvetica","bold"),e.setFontSize(20),e.setTextColor(...f),e.text(`Invoice ${b(i.invoice_number)}`,195,22,{align:"right"}),e.setFont("helvetica","normal"),e.setFontSize(9),e.setTextColor(...k),e.text("Tax invoice",195,27,{align:"right"});let le=28;if(a)try{let x=(/^data:image\/([a-z0-9+]+);/i.exec(a)?.[1]||"PNG").toUpperCase().replace("SVG+XML","SVG"),h=e.getImageProperties?e.getImageProperties(a):{width:100,height:100},I=16/h.height,ne=Math.min(45,h.width*I),de=h.height*I;e.addImage(a,x,15,14,ne,de),le=14+de+6}catch(u){console.warn("Invoice logo failed to render, falling back to name only.",u)}e.setFont("helvetica","bold"),e.setFontSize(16),e.setTextColor(...f),e.text(t.business_name||"Your Business",15,le);let L=44;if(e.setFont("helvetica","bold"),e.setFontSize(10),e.text("BILL TO",15,L),e.setFont("helvetica","normal"),e.setFontSize(10),e.setTextColor(...O),L+=5,e.text(b(i.bill_to_name)||"-",15,L),i.bill_to_address){let u=e.splitTextToSize(b(i.bill_to_address),80);for(let x of u)L+=4.5,e.text(x,15,L)}i.bill_to_email&&(L+=4.5,e.text(b(i.bill_to_email),15,L));let Ee=160,Ve=195,R=44,J=(u,x)=>{e.setFont("helvetica","normal"),e.setFontSize(10),e.setTextColor(...k),e.text(u,Ee,R,{align:"right"}),e.setFont("helvetica","bold"),e.setTextColor(...O),e.text(x||"-",Ve,R,{align:"right"}),R+=5};J("Issue date:",b(i.issue_date)),J("Due date:",b(i.due_date)),J("Reference:",b(i.invoice_number));let z=Math.max(L,R)+8,ee=16,U=180/4;e.setFillColor(...H),e.rect(15,z,U*3,ee,"F"),e.setFillColor(...f),e.rect(15+U*3,z,U,ee,"F");let j=(u,x,h,T=!1)=>{let I=15+U*h+4;e.setFont("helvetica","normal"),e.setFontSize(8),e.setTextColor(T?200:255,T?200:255,T?200:255),e.text(u,I,z+6),e.setFont("helvetica","bold"),e.setFontSize(T?13:11),e.setTextColor(255,255,255),e.text(x||"-",I,z+13)};j("Invoice No",b(i.invoice_number),0),j("Issue date",b(i.issue_date),1),j("Due date",b(i.due_date),2),j("Total due (GBP)",g(i.total).replace("GBP ","GBP "),3,!0);let _=z+ee+10,q=15,te=120,re=150,se=195;if(e.setFont("helvetica","bold"),e.setFontSize(9),e.setTextColor(...k),e.text("Description",q,_),e.text("Quantity",te,_,{align:"right"}),e.text("Unit price (GBP)",re,_,{align:"right"}),e.text("Amount (GBP)",se,_,{align:"right"}),_+=2,e.setDrawColor(200),e.line(15,_,195,_),_+=6,e.setFont("helvetica","normal"),e.setFontSize(10),e.setTextColor(...O),n.length===0)e.setTextColor(...k),e.text("No line items.",210/2,_,{align:"center"}),e.setTextColor(...O),_+=8;else for(let u of n){let x=e.splitTextToSize(b(u.description),te-q-6);e.text(x[0]??"",q,_),e.text(b(u.quantity),te,_,{align:"right"}),e.text(g(u.unit_price).replace("GBP ",""),re,_,{align:"right"}),e.text(g(u.line_total).replace("GBP ",""),se,_,{align:"right"}),_+=6}_+=2,e.setDrawColor(220),e.line(15,_,195,_),_+=6;let ie=195,$=(u,x,h=!1,T=10,I=O)=>{e.setFont("helvetica",h?"bold":"normal"),e.setFontSize(T),e.setTextColor(...I),e.text(u,q,_),e.text(x,ie,_,{align:"right"}),_+=6};if($("Subtotal:",g(i.subtotal).replace("GBP ","")),Number(i.tax_total)>0&&$(`${t.tax_label}:`,g(i.tax_total).replace("GBP ","")),_+=1,e.setDrawColor(150),e.line(ie-60,_,ie,_),_+=5,$("Total (GBP):",g(i.total).replace("GBP ",""),!0,12),(i.status==="part_paid"||i.status==="paid")&&($("Paid:",g(i.amount_paid).replace("GBP ",""),!1,10,k),i.status==="part_paid"&&$("Balance:",g(this.remainingBalance()).replace("GBP ",""),!0,10,[180,90,0])),t.show_bank_details&&(t.bank_name||t.bank_account_number)){_+=8,e.setFillColor(248,246,240);let u=30;e.rect(15,_,90,u,"F"),e.setDrawColor(...H),e.setLineWidth(.4),e.line(15,_,15,_+u),e.setLineWidth(.2),e.setFont("helvetica","bold"),e.setFontSize(9),e.setTextColor(...f),e.text("PAID TO",19,_+6),e.setFont("helvetica","normal"),e.setFontSize(9),e.setTextColor(...O);let x=_+12,h=ne=>{e.text(ne,19,x),x+=4.5};t.bank_name&&h(`Bank: ${t.bank_name}`),t.bank_account_name&&h(`Account name: ${t.bank_account_name}`),t.bank_account_number&&h(`Account no: ${t.bank_account_number}`),t.bank_sort_code&&h(`Sort code: ${t.bank_sort_code}`);let T=130;e.setFont("helvetica","normal"),e.setFontSize(9),e.setTextColor(...k),e.text("Issued by, signature",T,_+6);let I=t.signature_name||t.business_name||"";if(I){switch(t.signature_font){case"bold":e.setFont("helvetica","bolditalic"),e.setFontSize(18);break;case"script":e.setFont("times","italic"),e.setFontSize(22);break;default:e.setFont("times","italic"),e.setFontSize(18)}e.setTextColor(...f),e.text(I,T,_+22)}_+=u+4}else{_+=8;let u=130;e.setFont("helvetica","normal"),e.setFontSize(9),e.setTextColor(...k),e.text("Issued by, signature",u,_);let x=t.signature_name||t.business_name||"";if(x){switch(t.signature_font){case"bold":e.setFont("helvetica","bolditalic"),e.setFontSize(18);break;case"script":e.setFont("times","italic"),e.setFontSize(22);break;default:e.setFont("times","italic"),e.setFontSize(18)}e.setTextColor(...f),e.text(x,u,_+14)}_+=20}if(i.notes){_+=6,e.setFont("helvetica","italic"),e.setFontSize(9),e.setTextColor(...k);let u=e.splitTextToSize(b(i.notes),180);e.text(u,15,_),_+=4.5*u.length}let Y=275;e.setDrawColor(220),e.line(15,Y-4,195,Y-4),e.setFont("helvetica","normal"),e.setFontSize(8),e.setTextColor(...k);let X=[];if(t.business_phone&&X.push(t.business_phone),t.business_website&&X.push(t.business_website),t.business_email&&X.push(t.business_email),e.text(X.join("     "),210/2,Y,{align:"center"}),t.business_name){let u=Y+5;if(e.text(t.business_name,210/2,u,{align:"center"}),t.business_address){let x=e.splitTextToSize(t.business_address,160);for(let h of x)u+=4,e.text(h,210/2,u,{align:"center"})}}return e}viewPdf(){let e=this.detail();if(!e)return;let i=this.pickedTemplateId();if(i!=null){this.pdfBusy.set(!0),this.api.renderInvoiceTemplate(i,e.invoice.id).subscribe({next:a=>{this.pdfBusy.set(!1),this.openRenderedHtml(a.html,a.invoice_number,!1)},error:a=>{this.pdfBusy.set(!1),this.dialog.alert(a?.error?.error||"Template render failed.",{title:"View PDF",variant:"danger"})}});return}let n=this.buildPdfHtmlDocument(e.invoice,this.lines(),this.branding()),t=window.open("","_blank");if(!t){let a="data:text/html;charset=utf-8,"+encodeURIComponent(n);window.location.href=a;return}t.document.open(),t.document.write(n),t.document.close()}buildPdfHtmlDocument(e,i,n){let t=f=>f==null?"":String(f).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;").replace(/'/g,"&#39;"),a=f=>this.formatMoney(f),g=f=>t(f).replace(/\n/g,"<br />"),b=i.length===0?'<tr><td colspan="4" style="padding:12px;color:#888;text-align:center;">No line items.</td></tr>':i.map(f=>`
          <tr>
            <td>${t(f.description)}</td>
            <td class="num">${t(f.quantity)}</td>
            <td class="num">${t(a(f.unit_price))}</td>
            <td class="num">${t(a(f.line_total))}</td>
          </tr>
        `).join(""),W=e.status==="part_paid"||e.status==="paid"?`<div class="row"><div class="label">Paid</div><div class="value">${t(a(e.amount_paid))}</div></div>`+(e.status==="part_paid"?`<div class="row balance"><div class="label">Balance</div><div class="value">${t(a(this.remainingBalance()))}</div></div>`:""):"",ae=n.signature_font==="bold"?"font-family: 'Brush Script MT', 'Lucida Handwriting', cursive; font-size: 32px; font-weight: 700;":n.signature_font==="script"?"font-family: 'Brush Script MT', 'Lucida Handwriting', cursive; font-size: 36px;":"font-family: 'Times New Roman', Times, serif; font-style: italic; font-size: 28px;",oe=n.signature_name||n.business_name||"",H=n.show_bank_details&&(n.bank_name||n.bank_account_number)?`
      <div class="paid-to">
        <div class="paid-to-label">PAID TO</div>
        ${n.bank_name?`<div><span class="k">Bank</span> ${t(n.bank_name)}</div>`:""}
        ${n.bank_account_name?`<div><span class="k">Account name</span> ${t(n.bank_account_name)}</div>`:""}
        ${n.bank_account_number?`<div><span class="k">Account no</span> ${t(n.bank_account_number)}</div>`:""}
        ${n.bank_sort_code?`<div><span class="k">Sort code</span> ${t(n.bank_sort_code)}</div>`:""}
      </div>`:"";return`<!doctype html>
<html>
<head>
<meta charset="utf-8" />
<title>Invoice ${t(e.invoice_number)}</title>
<style>
  body { margin: 0; background: #f4f4f4; font-family: Arial, Helvetica, sans-serif; color: #333; font-size: 12px; }
  .bar {
    position: sticky; top: 0; z-index: 10;
    background: #111; color: #fff; padding: 10px 20px;
    display: flex; align-items: center; gap: 12px;
  }
  .bar button {
    background: #d4a93a; color: #111; border: 0; padding: 8px 16px;
    border-radius: 4px; cursor: pointer; font-weight: 600;
  }
  .bar .hint { color: #aaa; font-size: 13px; }

  .sheet {
    max-width: 820px; margin: 24px auto; background: #fff;
    padding: 48px; box-shadow: 0 2px 12px rgba(0,0,0,0.1);
    box-sizing: border-box;
  }

  /* Header */
  .head { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 32px; gap: 24px; }
  .head .biz { display: flex; flex-direction: column; align-items: flex-start; gap: 8px; }
  .head .biz .logo { max-height: 60px; max-width: 180px; object-fit: contain; }
  .head .biz .biz-name { font-size: 20px; font-weight: 700; color: #222; }
  .head .inv-title { text-align: right; }
  .head .inv-title h1 { margin: 0; font-size: 26px; color: #222; font-weight: 600; }
  .head .inv-title .sub { color: #888; font-size: 11px; margin-top: 2px; }

  /* Recipient + meta grid */
  .recipient { display: flex; justify-content: space-between; margin-bottom: 24px; gap: 40px; }
  .bill-to { flex: 1; }
  .bill-to .label { font-weight: 700; margin-bottom: 6px; }
  .bill-to .lines { line-height: 1.5; }
  .meta { min-width: 220px; }
  .meta .row { display: flex; justify-content: space-between; padding: 3px 0; }
  .meta .row .k { color: #888; }
  .meta .row .v { font-weight: 700; }

  /* Summary bar */
  .summary { display: grid; grid-template-columns: 1fr 1fr 1fr 1.2fr; margin-bottom: 24px; }
  .summary .cell { padding: 10px 14px; background: #d4a93a; color: #fff; }
  .summary .cell.dark { background: #222; }
  .summary .cell .lbl { font-size: 10px; opacity: 0.9; }
  .summary .cell .val { font-size: 15px; font-weight: 700; margin-top: 3px; }
  .summary .cell.dark .val { font-size: 20px; }

  /* Line items */
  table.items { width: 100%; border-collapse: collapse; margin-bottom: 20px; }
  table.items th { padding: 8px 4px; text-align: left; color: #888; font-weight: 600; font-size: 11px; border-bottom: 1px solid #ccc; }
  table.items th.num, table.items td.num { text-align: right; }
  table.items td { padding: 10px 4px; border-bottom: 1px solid #eee; }

  /* Totals */
  .totals { max-width: 320px; margin-left: auto; margin-bottom: 24px; }
  .totals .row { display: flex; justify-content: space-between; padding: 4px 0; }
  .totals .row.total { font-weight: 700; font-size: 14px; border-top: 1px solid #999; padding-top: 8px; margin-top: 4px; color: #222; }
  .totals .row.balance .value { color: #b45309; font-weight: 700; }

  /* PAID TO + signature */
  .footer-block { display: grid; grid-template-columns: 1fr 1fr; gap: 40px; margin-top: 32px; }
  .paid-to { padding: 14px 16px; background: #f8f6f0; border-left: 3px solid #d4a93a; }
  .paid-to .paid-to-label { font-weight: 700; margin-bottom: 8px; font-size: 11px; letter-spacing: 0.5px; }
  .paid-to div { line-height: 1.7; }
  .paid-to .k { color: #888; display: inline-block; min-width: 100px; }
  .sig { text-align: left; }
  .sig .sig-label { color: #888; font-size: 11px; margin-bottom: 8px; }
  .sig .sig-name { ${ae} color: #222; line-height: 1.2; }

  /* Notes */
  .notes { margin-top: 24px; color: #666; white-space: pre-wrap; font-style: italic; }

  /* Page footer */
  .foot { margin-top: 44px; padding-top: 12px; border-top: 1px solid #eee; text-align: center; color: #999; font-size: 11px; }
  .foot .contact span { margin: 0 10px; }
  .foot .biz-line { margin-top: 6px; color: #666; }

  @media print {
    body { background: #fff; }
    .bar { display: none; }
    .sheet { box-shadow: none; margin: 0; max-width: none; padding: 20mm; }
    @page { size: A4; margin: 0; }
  }
</style>
</head>
<body>
  <div class="bar">
    <button onclick="window.print()">Print / Save as PDF</button>
    <span class="hint">Ctrl+P (Cmd+P on Mac) also opens the print dialog.</span>
  </div>

  <div class="sheet">
    <div class="head">
      <div class="biz">
        ${n.logo_url?`<img class="logo" src="${t(n.logo_url)}" alt="" />`:""}
        <div class="biz-name">${t(n.business_name||"Your Business")}</div>
      </div>
      <div class="inv-title">
        <h1>Invoice ${t(e.invoice_number)}</h1>
        <div class="sub">Tax invoice</div>
      </div>
    </div>

    <div class="recipient">
      <div class="bill-to">
        <div class="label">BILL TO</div>
        <div class="lines">
          ${t(e.bill_to_name)||"&mdash;"}
          ${e.bill_to_address?`<br />${g(e.bill_to_address)}`:""}
          ${e.bill_to_email?`<br />${t(e.bill_to_email)}`:""}
        </div>
      </div>
      <div class="meta">
        <div class="row"><span class="k">Issue date:</span><span class="v">${t(e.issue_date)||"&mdash;"}</span></div>
        <div class="row"><span class="k">Due date:</span><span class="v">${t(e.due_date)||"&mdash;"}</span></div>
        <div class="row"><span class="k">Reference:</span><span class="v">${t(e.invoice_number)||"&mdash;"}</span></div>
      </div>
    </div>

    <div class="summary">
      <div class="cell"><div class="lbl">Invoice No</div><div class="val">${t(e.invoice_number)}</div></div>
      <div class="cell"><div class="lbl">Issue date</div><div class="val">${t(e.issue_date)}</div></div>
      <div class="cell"><div class="lbl">Due date</div><div class="val">${t(e.due_date)||"\u2014"}</div></div>
      <div class="cell dark"><div class="lbl">Total due (GBP)</div><div class="val">${t(a(e.total))}</div></div>
    </div>

    <table class="items">
      <thead>
        <tr>
          <th>Description</th>
          <th class="num" style="width:70px;">Quantity</th>
          <th class="num" style="width:110px;">Unit price (\xA3)</th>
          <th class="num" style="width:110px;">Amount (\xA3)</th>
        </tr>
      </thead>
      <tbody>${b}</tbody>
    </table>

    <div class="totals">
      <div class="row"><div class="label">Subtotal:</div><div class="value">${t(a(e.subtotal))}</div></div>
      ${Number(e.tax_total)>0?`<div class="row"><div class="label">${t(n.tax_label)}:</div><div class="value">${t(a(e.tax_total))}</div></div>`:""}
      <div class="row total"><div class="label">Total (GBP):</div><div class="value">${t(a(e.total))}</div></div>
      ${W}
    </div>

    <div class="footer-block">
      ${H||"<div></div>"}
      <div class="sig">
        <div class="sig-label">Issued by, signature</div>
        <div class="sig-name">${t(oe)}</div>
      </div>
    </div>

    ${e.notes?`<div class="notes">${t(e.notes)}</div>`:""}

    <div class="foot">
      <div class="contact">
        ${n.business_phone?`<span>&#9742; ${t(n.business_phone)}</span>`:""}
        ${n.business_website?`<span>&#9673; ${t(n.business_website)}</span>`:""}
        ${n.business_email?`<span>&#9993; ${t(n.business_email)}</span>`:""}
      </div>
      ${n.business_name?`<div class="biz-line">${t(n.business_name)}${n.business_address?"<br />"+g(n.business_address):""}</div>`:""}
    </div>
  </div>
</body>
</html>`}async sendEmail(){let e=this.detail()?.invoice;if(!e?.id||this.emailBusy())return;let i=e.bill_to_email;if(!i){this.dialog.alert("No email address on this invoice. Set Bill to \u2192 Email first.",{title:"Send email",variant:"danger"});return}await this.dialog.confirm(`Send invoice ${e.invoice_number} to ${i}?`,{title:"Send invoice",confirmLabel:"Send"})&&(this.emailBusy.set(!0),this.error.set(null),this.api.emailInvoice(e.id).subscribe({next:t=>{this.emailBusy.set(!1),this.emailSentTo.set(t.sent_to),this.reload()},error:t=>{this.emailBusy.set(!1),this.error.set(t?.error?.error||"Email failed")}}))}markSent(){let e=this.detail()?.invoice?.id;e&&this.api.sendInvoice(e).subscribe({next:()=>this.reload()})}markPaid(){let e=this.detail()?.invoice?.id;e&&this.api.markInvoicePaid(e).subscribe({next:()=>this.reload()})}markPartPaid(){let e=this.detail()?.invoice?.id;e&&this.api.markInvoicePartPaid(e).subscribe({next:()=>this.reload()})}savePaid(){let e=this.detail()?.invoice;if(!e?.id)return;let i=this.paidDraft(),n=i==null||i===""?null:Number(i);n!==null&&!Number.isFinite(n)||this.api.updateInvoice(e.id,{amount_paid:n}).subscribe({next:()=>this.reload(),error:t=>this.error.set(t?.error?.error||"Save failed")})}static \u0275fac=function(i){return new(i||r)};static \u0275cmp=me({type:r,selectors:[["app-invoice-detail-modal"]],inputs:{invoiceId:"invoiceId"},outputs:{closed:"closed"},features:[pe],decls:1,vars:1,consts:[[1,"modal-backdrop"],[1,"modal-backdrop",3,"click"],[1,"modal",2,"max-width","780px",3,"click"],[1,"modal-head"],[1,"pill",2,"margin-left","8px"],[1,"ghost","icon-btn",3,"click"],[1,"modal-body"],[1,"muted"],[1,"modal-foot","invoice-foot"],[1,"status-group"],[1,"status-label"],[1,"primary",3,"click"],[1,"row","two-col"],["name","id_bt",3,"ngModelChange","change","ngModel"],["name","id_em",3,"ngModelChange","change","ngModel"],["type","date","name","id_iss",3,"ngModelChange","change","ngModel"],["type","date","name","id_due",3,"ngModelChange","change","ngModel"],[2,"margin-top","12px"],[1,"muted","small"],[1,"new-invoice-services"],[1,"data","invoice-lines"],[2,"width","70px"],[2,"width","100px"],[2,"width","36px"],[1,"ghost","small",2,"margin-top","6px",3,"click"],[1,"totals-panel"],[1,"totals-actions"],[1,"tpl-picker"],[1,"ghost","action-btn",3,"click","disabled"],[1,"icon"],[1,"ghost","action-btn",3,"click","disabled","title"],[1,"totals-card"],[1,"row"],[1,"k"],[1,"v"],[1,"divider"],[1,"row","grand"],[1,"error-msg",2,"margin-top","10px"],["title","Remove from invoice",1,"ghost","icon-btn","danger",3,"click"],[3,"ngModelChange","change","ngModel","name"],["type","number","min","0","step","0.01",3,"ngModelChange","change","ngModel","name"],["title","Remove",1,"ghost","icon-btn","danger",3,"click"],[1,"tpl-picker-label"],["name","tpl_pick",3,"ngModelChange","ngModel"],[3,"ngValue"],[1,"row","paid-row"],[1,"paid-input"],[1,"row","balance"],[1,"progress",3,"title"],[1,"bar"],[1,"prefix"],["type","number","min","0","step","0.01","name","id_amt",3,"ngModelChange","change","ngModel"],[1,"status-chip","current"],[1,"status-chip",3,"click"]],template:function(i,n){i&1&&C(0,Je,19,4,"div",0),i&2&&w(n.invoiceId!=null&&n.open()?0:-1)},dependencies:[xe,ke,Me,Te,fe,we,ye,he,Ie,Ce],styles:['@charset "UTF-8";.totals-panel[_ngcontent-%COMP%]{display:flex;align-items:flex-start;justify-content:space-between;gap:24px;margin-top:16px;flex-wrap:wrap}.totals-actions[_ngcontent-%COMP%]{display:flex;flex-direction:column;gap:8px;flex:1;min-width:180px}.totals-actions[_ngcontent-%COMP%]   .action-btn[_ngcontent-%COMP%]{display:inline-flex;align-items:center;gap:8px;padding:8px 14px;border-radius:var(--radius-sm);background:var(--bg-2);border:1px solid var(--line);color:var(--fg);cursor:pointer;font-size:13px;transition:border-color .12s ease,background .12s ease;justify-content:flex-start}.totals-actions[_ngcontent-%COMP%]   .action-btn[_ngcontent-%COMP%]:hover:not([disabled]){border-color:var(--primary);color:var(--primary)}.totals-actions[_ngcontent-%COMP%]   .action-btn[disabled][_ngcontent-%COMP%]{opacity:.55;cursor:not-allowed}.totals-actions[_ngcontent-%COMP%]   .action-btn[_ngcontent-%COMP%]   .icon[_ngcontent-%COMP%]{font-size:14px}.totals-actions[_ngcontent-%COMP%]   .tpl-picker[_ngcontent-%COMP%]{display:flex;flex-direction:column;gap:4px;margin-bottom:4px}.totals-actions[_ngcontent-%COMP%]   .tpl-picker-label[_ngcontent-%COMP%]{color:var(--muted);text-transform:uppercase;letter-spacing:.5px;font-size:11px}.totals-actions[_ngcontent-%COMP%]   .tpl-picker[_ngcontent-%COMP%]   select[_ngcontent-%COMP%]{padding:6px 10px;background:var(--bg-2);border:1px solid var(--line);color:var(--fg);border-radius:var(--radius-sm);font:inherit}.totals-card[_ngcontent-%COMP%]{width:100%;max-width:320px;background:var(--bg-3);border:1px solid var(--line);border-radius:var(--radius-sm);padding:14px 18px;display:flex;flex-direction:column;gap:8px;font-size:14px}.totals-card[_ngcontent-%COMP%]   .row[_ngcontent-%COMP%]{display:flex;align-items:center;justify-content:space-between;gap:12px}.totals-card[_ngcontent-%COMP%]   .k[_ngcontent-%COMP%]{color:var(--muted);text-transform:uppercase;letter-spacing:.5px;font-size:11px}.totals-card[_ngcontent-%COMP%]   .v[_ngcontent-%COMP%]{color:var(--fg);font-variant-numeric:tabular-nums}.totals-card[_ngcontent-%COMP%]   .divider[_ngcontent-%COMP%]{height:1px;background:var(--line);margin:2px 0}.totals-card[_ngcontent-%COMP%]   .grand[_ngcontent-%COMP%]   .k[_ngcontent-%COMP%]{color:var(--fg);font-size:12px}.totals-card[_ngcontent-%COMP%]   .grand[_ngcontent-%COMP%]   .v[_ngcontent-%COMP%]{color:var(--primary);font-size:18px;font-weight:700}.totals-card[_ngcontent-%COMP%]   .paid-row[_ngcontent-%COMP%]   .v[_ngcontent-%COMP%]{color:#60a5fa;font-weight:600}.totals-card[_ngcontent-%COMP%]   .paid-input[_ngcontent-%COMP%]{display:inline-flex;align-items:center;gap:0;background:var(--bg-2);border:1px solid var(--line);border-radius:4px;padding:0 8px}.totals-card[_ngcontent-%COMP%]   .paid-input[_ngcontent-%COMP%]   .prefix[_ngcontent-%COMP%]{color:var(--muted);margin-right:2px}.totals-card[_ngcontent-%COMP%]   .paid-input[_ngcontent-%COMP%]   input[_ngcontent-%COMP%]{border:none;background:transparent;color:var(--fg);padding:4px 0;width:90px;text-align:right;font-variant-numeric:tabular-nums}.totals-card[_ngcontent-%COMP%]   .paid-input[_ngcontent-%COMP%]   input[_ngcontent-%COMP%]:focus{outline:none}.totals-card[_ngcontent-%COMP%]   .balance[_ngcontent-%COMP%]   .k[_ngcontent-%COMP%]{color:var(--muted)}.totals-card[_ngcontent-%COMP%]   .balance[_ngcontent-%COMP%]   .v[_ngcontent-%COMP%]{color:var(--danger);font-weight:600}.totals-card[_ngcontent-%COMP%]   .balance.zero[_ngcontent-%COMP%]   .v[_ngcontent-%COMP%]{color:var(--muted);font-weight:500}.totals-card[_ngcontent-%COMP%]   .progress[_ngcontent-%COMP%]{height:6px;background:var(--bg-2);border-radius:999px;overflow:hidden;margin-top:4px}.totals-card[_ngcontent-%COMP%]   .progress[_ngcontent-%COMP%]   .bar[_ngcontent-%COMP%]{height:100%;background:#60a5fa;border-radius:999px;transition:width .2s ease}.invoice-foot[_ngcontent-%COMP%]{justify-content:space-between;align-items:center;gap:12px}.status-group[_ngcontent-%COMP%]{display:flex;align-items:center;gap:8px;flex-wrap:wrap}.status-label[_ngcontent-%COMP%]{color:var(--muted);text-transform:uppercase;letter-spacing:.5px;font-size:11px;margin-right:4px}.status-chip[_ngcontent-%COMP%]{padding:6px 12px;border-radius:999px;font-size:12px;font-weight:600;letter-spacing:.3px;background:transparent;color:var(--muted);border:1px solid var(--line);cursor:pointer;transition:background .12s ease,color .12s ease,border-color .12s ease}.status-chip[_ngcontent-%COMP%]:hover:not(.current){border-color:var(--primary);color:var(--fg)}.status-chip.current[_ngcontent-%COMP%]{cursor:default}.status-chip.current[data-inv-status=draft][_ngcontent-%COMP%]{color:var(--muted);border-color:var(--muted);background:var(--bg-3)}.status-chip.current[data-inv-status=sent][_ngcontent-%COMP%]{color:#f59e0b;border-color:#f59e0b;background:#f59e0b1a}.status-chip.current[data-inv-status=part_paid][_ngcontent-%COMP%]{color:#60a5fa;border-color:#60a5fa;background:#60a5fa1f}.status-chip.current[data-inv-status=paid][_ngcontent-%COMP%]{color:#56c98a;border-color:#56c98a;background:#56c98a1f}']})};export{De as a};

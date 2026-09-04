import{O as e}from"./v4-BJmWi5kg.js";import{d as t,f as n,p as r}from"./helpers-DGW9OV4V.js";var i=t(),a=e(r(),1),o=`
.sb-modal-backdrop {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.5);
  z-index: 9998;
}
.sb-modal-container {
  border-radius: 12px;
  position: fixed;
  inset: 0;
  margin: auto;
  width: fit-content;
  height: fit-content;
  background: white;
  z-index: 9999;
}
`;function s({children:e}){let t=n(),r=t.getHostContextStore(`display`),{mode:s}=(0,a.useSyncExternalStore)(r.subscribe,r.getSnapshot),c=s===`modal`;return(0,a.useEffect)(()=>{if(!c)return;let e=e=>{e.key===`Escape`&&t.closeModal()};return document.addEventListener(`keydown`,e),()=>document.removeEventListener(`keydown`,e)},[c,t]),(0,i.jsxs)(i.Fragment,{children:[(0,i.jsx)(`style`,{children:o}),c&&(0,i.jsx)(`div`,{role:`dialog`,className:`sb-modal-backdrop`,onClick:e=>{e.target===e.currentTarget&&t.closeModal()}}),(0,i.jsx)(`div`,{className:c?`sb-modal-container`:void 0,children:e})]})}export{s as ModalProvider};
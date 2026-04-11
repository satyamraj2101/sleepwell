async function s(a,t,r){return(await a.get(`/api/${t}/contractapproval/preexecution/${r}`)).data}async function e(a,t,r,o){var p;const n=await a.get(`/api/${t}/v1/contractapproval/contractsnapshotapprovals`,{params:{requestId:r,requestorUsername:o}});return Array.isArray(n.data)?n.data:((p=n.data)==null?void 0:p.data)??[]}export{e as a,s as g};
//# sourceMappingURL=approval-B79i3BaC.js.map

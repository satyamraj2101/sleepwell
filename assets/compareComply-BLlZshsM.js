async function o(a,t,r){return(await a.get(`/api/${t}/compare-comply/score-card`,{params:{requestId:r}})).data}async function s(a,t,r){await a.post(`/api/${t}/compare-comply/run-ai`,r)}async function n(a,t,r,e){return(await a.post(`/api/${t}/compare-comply/request-item/lock`,null,{params:{ItemId:r,State:e}})).data}export{o as g,n as l,s as r};
//# sourceMappingURL=compareComply-BLlZshsM.js.map

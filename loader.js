function parseCSV(text){
  const rows=[], row=[], len=text.length; let i=0, f="", q=false;
  while(i<len){
    const c=text[i];
    if(c==='\"'){
      if(q && text[i+1]==='\"'){ f+='\"'; i+=2; continue; }
      q=!q; i++; continue;
    }
    if(!q && (c===',' || c==='\n' || c==='\r')){
      row.push(f); f="";
      if(c===',' ){ i++; continue; }
      if(c==='\r' && text[i+1]==='\n') i++;
      i++;
      rows.push(row.splice(0));
      continue;
    }
    f+=c; i++;
  }
  row.push(f); if(row.length) rows.push(row);
  return rows;
}

function recordsFromCSV(text){
  const rows=parseCSV(text).filter(r=>r.length && r.some(x=>x!==""));
  if(!rows.length) return [];
  const headers=rows[0].map(h=>h.trim());
  return rows.slice(1).map(r=>{
    const o={}; headers.forEach((h,idx)=>o[h]= (r[idx]??"").trim()); return o;
  });
}

function popupHTML(o){
  const name=o.name||'Food Bank';
  const addr=o.address||'';
  const phone=o.phone?`<br>${o.phone}`:'';
  const hours=o.hours?`<br>${o.hours}`:'';
  const cat=o.category?`<br><i>${o.category}</i>`:'';
  const web=o.website?`<br><a href="${o.website}" target="_blank" rel="noopener">Website</a>`:'';
  return `<b>${name}</b><br>${addr}${phone}${hours}${cat}${web}`;
}

window.addEventListener('DOMContentLoaded', async ()=>{
  const map=L.map('map').setView([34.1425,-118.2551],11);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',{attribution:'© OpenStreetMap contributors'}).addTo(map);

  const csv=await fetch('foodbanks.csv').then(r=>r.text());
  const data=recordsFromCSV(csv);
  const bounds=L.latLngBounds();
  data.forEach(o=>{
    const lat=parseFloat(o.lat), lng=parseFloat(o.lng);
    if(Number.isFinite(lat)&&Number.isFinite(lng)){
      L.marker([lat,lng]).addTo(map).bindPopup(popupHTML(o));
      bounds.extend([lat,lng]);
    }
  });
  if(bounds.isValid()) map.fitBounds(bounds,{padding:[20,20]});
});

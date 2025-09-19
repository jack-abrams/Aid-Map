function parseCSV(text){
  if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1);
  const rows=[], row=[], len=text.length; let i=0, f="", q=false;
  while(i<len){
    const c=text[i];
    if(c==='\"'){ if(q && text[i+1]==='\"'){ f+='\"'; i+=2; continue; } q=!q; i++; continue; }
    if(!q && (c===',' || c==='\n' || c==='\r')){
      row.push(f); f="";
      if(c===','){ i++; continue; }
      if(c==='\r' && text[i+1]==='\n') i++;
      i++; rows.push(row.splice(0)); continue;
    }
    f+=c; i++;
  }
  row.push(f); if(row.length) rows.push(row);
  return rows.filter(r => r.length && r.some(x=>x!==""));
}
function recordsFromCSV(text){
  const rows = parseCSV(text);
  if (!rows.length) return [];
  const headers = rows[0].map(h=>h.trim());
  return rows.slice(1).map(r=>{
    const o={}; headers.forEach((h,i)=> o[h] = (r[i] ?? "").trim()); return o;
  });
}
function csvToGeoJSONRecs(recs){
  const feats=[];
  for (const o of recs){
    const lat = parseFloat(o.lat), lng = parseFloat(o.lng);
    if (Number.isFinite(lat) && Number.isFinite(lng)){
      feats.push({ type: "Feature", geometry: { type: "Point", coordinates: [lng, lat] }, properties: o });
    }
  }
  return { type: "FeatureCollection", features: feats };
}

(async function(){
  const STYLE_URL = "https://api.maptiler.com/maps/streets-v2/style.json?key=sfj85VORuGeFauZZw7Iy";

  const map = new maplibregl.Map({
    container: "map",
    style: STYLE_URL,
    center: [-118.2551, 34.1425],
    zoom: 11
  });
  map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "bottom-right");

  const csvText = await fetch("foodbanks.csv", { cache: "no-store" }).then(r=>r.text());
  const records = recordsFromCSV(csvText);
  const points = csvToGeoJSONRecs(records);

  map.on("load", async () => {
    map.addSource("banks", { type: "geojson", data: points, cluster: true, clusterRadius: 50 });
    map.addLayer({
      id: "clusters", type: "circle", source: "banks", filter: ["has", "point_count"],
      paint: {
        "circle-color": ["step", ["get", "point_count"], "#a5b4fc", 10, "#818cf8", 25, "#6366f1", 50, "#4f46e5"],
        "circle-radius": ["step", ["get", "point_count"], 14, 10, 18, 25, 22, 50, 28]
      }
    });
    map.addLayer({
      id: "cluster-count", type: "symbol", source: "banks", filter: ["has", "point_count"],
      layout: { "text-field": ["get", "point_count_abbreviated"], "text-size": 12 },
      paint: { "text-color": "#ffffff" }
    });
    map.addLayer({
      id: "unclustered", type: "circle", source: "banks", filter: ["!", ["has", "point_count"]],
      paint: { "circle-radius": 6, "circle-color": "#22c55e", "circle-stroke-color": "#ffffff", "circle-stroke-width": 2 }
    });

    const popup = new maplibregl.Popup({ closeButton: false, closeOnClick: true });
    map.on("click", "unclustered", (e) => {
      const f = e.features[0]; const p = f.properties || {};
      const html = `<b>${p.name||"Food Bank"}</b><br>${p.address||""}`
        + (p.phone?`<br>${p.phone}`:"") + (p.hours?`<br>${p.hours}`:"")
        + (p.website?`<br><a href="${p.website}" target="_blank" rel="noopener">Website</a>`:"");
      popup.setLngLat(f.geometry.coordinates).setHTML(html).addTo(map);
    });
    map.on("click", "clusters", async (e) => {
      const features = map.queryRenderedFeatures(e.point, { layers: ["clusters"] });
      const clusterId = features[0].properties.cluster_id;
      const src = map.getSource("banks");
      const zoom = await src.getClusterExpansionZoom(clusterId);
      map.easeTo({ center: features[0].geometry.coordinates, zoom });
    });

    if (points.features.length){
      const b = new maplibregl.LngLatBounds();
      points.features.forEach(f => b.extend(f.geometry.coordinates));
      map.fitBounds(b, { padding: 24, maxZoom: 13, duration: 500 });
    }

    const breaks = [0,1,2,4,8,15,25,50];
    const colors = ["#FFEDA0","#FED976","#FEB24C","#FD8D3C","#FC4E2A","#E31A1C","#BD0026","#800026"];
    const areasRaw = await fetch("areas.geojson", { cache: "no-store" }).then(r=>r.ok?r.json():null).catch(()=>null);

    if (areasRaw && areasRaw.features?.length){
      let idCounter = 1;
      const areas = {
        type: "FeatureCollection",
        features: areasRaw.features.map(f => {
          const p = f.properties || {};
          const rate = (p.population>0)?(1000*(p.homeless||0)/p.population):(p.homeless||0);
          return { ...f, id:(p.id??idCounter++), properties:{...p,rate} };
        })
      };

      map.addSource("areas", { type:"geojson", data:areas, promoteId:"id" });

      map.addLayer({
        id:"areas-fill",
        type:"fill",
        source:"areas",
        layout:{visibility:"none"},
        paint:{
          "fill-color":[
            "step",["get","rate"],
            colors[0],breaks[1],colors[1],breaks[2],colors[2],breaks[3],colors[3],
            breaks[4],colors[4],breaks[5],colors[5],breaks[6],colors[6],breaks[7],colors[7]
          ],
          "fill-opacity":[
            "case", ["boolean",["feature-state","hover"],false], 0.9, 0.65
          ]
        }
      }, "clusters");

      map.addLayer({
        id:"areas-outline",
        type:"line",
        source:"areas",
        layout:{visibility:"none"},
        paint:{"line-color":"#fff","line-width":1}
      }, "clusters");

      let hoveredId = null;
      const areaPopup = new maplibregl.Popup({ closeButton:false, closeOnClick:false, offset:8 });

      function areaHTML(p){
        const rate = (p.rate||0).toFixed(1);
        const cnt = (p.homeless ?? "—");
        const pop = p.population ? Number(p.population).toLocaleString() : "—";
        return `<b>${p.name||"Area"}</b><br>Count: <b>${cnt}</b>` +
               (p.population ? `<br>Rate: <b>${rate}</b> / 1,000<br>Population: ${pop}` : "");
      }

      map.on("mousemove","areas-fill",(e)=>{
        if (!e.features.length) return;
        const f = e.features[0];
        if (hoveredId !== null) map.setFeatureState({source:"areas", id: hoveredId}, {hover:false});
        hoveredId = f.id;
        map.setFeatureState({source:"areas", id: hoveredId}, {hover:true});
        areaPopup.setLngLat(e.lngLat).setHTML(areaHTML(f.properties)).addTo(map);
      });

      map.on("mouseleave","areas-fill",()=>{
        if (hoveredId !== null) map.setFeatureState({source:"areas", id: hoveredId}, {hover:false});
        hoveredId = null;
        areaPopup.remove();
      });

      map.on("click","areas-fill",(e)=>{
        if (!e.features.length) return;
        const f = e.features[0];
        new maplibregl.Popup({closeButton:true, closeOnClick:true, offset:8})
          .setLngLat(e.lngLat)
          .setHTML(areaHTML(f.properties))
          .addTo(map);
      });

      const checkbox = document.getElementById("toggle-choropleth");
      const legend = document.getElementById("legend");
      let html = "<b>Homeless per 1,000</b>";
      for(let i=0;i<breaks.length;i++){
        const from=breaks[i], to=breaks[i+1];
        html += `<div class="legend-row"><span class="swatch" style="background:${colors[i]}"></span>${from}${to?`–${to}`:"+"}</div>`;
      }
      legend.innerHTML = html;
      function setChoroVisible(vis){
        const v = vis?"visible":"none";
        map.setLayoutProperty("areas-fill","visibility",v);
        map.setLayoutProperty("areas-outline","visibility",v);
        legend.style.display = vis?"block":"none";
      }
      checkbox.addEventListener("change", e=>setChoroVisible(e.target.checked));
    }

    const q = document.getElementById("q");
    const reset = document.getElementById("reset");
    function applyFilter(){
      const s = (q.value||"").toLowerCase();
      if(!s){ map.setFilter("unclustered",["!",["has","point_count"]]); return; }
      map.setFilter("unclustered",[
        "all",["!",["has","point_count"]],
        ["any",
          ["in",["literal",s],["downcase",["get","name"]]],
          ["in",["literal",s],["downcase",["get","address"]]],
          ["in",["literal",s],["downcase",["get","category"]]]
        ]
      ]);
    }
    q.addEventListener("input", applyFilter);
    reset.addEventListener("click", ()=>{ q.value=""; applyFilter(); });
  });
})();
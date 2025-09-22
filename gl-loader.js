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

function toNumber(value){
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
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

    const breaks = [0,1,2,3,4,5,6,7,8];
    const colors = ["#f2f0f7","#dadaeb","#bcbddc","#9e9ac8","#807dba","#6a51a3","#54278f","#3f007d","#250064"];
    const perCapitaText = await fetch("CA_Counties__Homeless_People_per_1_000__official___estimates_.csv", { cache: "no-store" })
      .then(r=>r.ok?r.text():null)
      .catch(()=>null);
    const perCapitaMap = new Map();
    if (perCapitaText){
      const perCapitaRecords = recordsFromCSV(perCapitaText);
      for (const rec of perCapitaRecords){
        const key = (rec.county||"").trim().toLowerCase();
        if(!key) continue;
        perCapitaMap.set(key, {
          rate: toNumber(rec.per_1000),
          homeless: toNumber(rec.homeless_people),
          population: toNumber(rec.population),
          year: toNumber(rec.year),
          method: (rec.method||"").trim() || null
        });
      }
    }
    const areasRaw = await fetch("areas.geojson", { cache: "no-store" }).then(r=>r.ok?r.json():null).catch(()=>null);

    if (areasRaw && areasRaw.features?.length){
      let idCounter = 1;
      const areas = {
        type: "FeatureCollection",
        features: areasRaw.features.map(f => {
          const p = f.properties || {};
          const nameKey = (p.name||"").trim().toLowerCase();
          const stats = perCapitaMap.get(nameKey);
          const csvRate = stats?.rate ?? null;
          const homeless = (stats?.homeless ?? toNumber(p.homeless));
          const featurePopulation = toNumber(p.population ?? p.population_estimate ?? p.population_total);
          const population = stats?.population ?? featurePopulation;
          const featureRate = toNumber(p.rate ?? p.homeless_per_1000 ?? p.per_1000);
          const derivedRate = (Number.isFinite(homeless) && Number.isFinite(population) && population > 0)
            ? (homeless / population) * 1000
            : null;
          let rate = null;
          if (Number.isFinite(csvRate)) rate = csvRate;
          else if (Number.isFinite(featureRate)) rate = featureRate;
          else if (Number.isFinite(derivedRate)) rate = derivedRate;
          const year = stats?.year ?? toNumber(p.homeless_as_of_year ?? p.homeless_year);
          const props = { ...p, rate: Number.isFinite(rate) ? rate : null };
          if (Number.isFinite(homeless)) props.homeless = homeless;
          if (Number.isFinite(population)) props.population = population;
          if (Number.isFinite(year)) props.homeless_as_of_year = year;
          if (stats?.method) props.per_1000_method = stats.method;
          return { ...f, id:(p.id??idCounter++), properties: props };
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
            "case",
              ["==", ["get","rate"], null], "rgba(0,0,0,0)",
              ["step",["get","rate"],
                colors[0],breaks[1],colors[1],breaks[2],colors[2],breaks[3],colors[3],
                breaks[4],colors[4],breaks[5],colors[5],breaks[6],colors[6],breaks[7],colors[7],
                breaks[8],colors[8]
              ]
          ],
          "fill-opacity":[
            "case",
              ["==", ["get","rate"], null], 0,
              ["boolean",["feature-state","hover"],false], 0.9,
              0.65
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
        const rate = Number.isFinite(p.rate) ? p.rate.toFixed(1) : null;
        const cnt = Number.isFinite(p.homeless) ? Number(p.homeless).toLocaleString() : null;
        const pop = Number.isFinite(p.population) ? Number(p.population).toLocaleString() : null;
        let html = `<b>${p.name||"Area"}</b>`;
        if (cnt !== null) html += `<br>Count: <b>${cnt}</b>`;
        if (rate !== null) html += `<br>Rate: <b>${rate}</b> / 1,000`;
        if (pop !== null) html += `<br>Population: ${pop}`;
        if (Number.isFinite(p.homeless_as_of_year)) html += `<br>Year: ${p.homeless_as_of_year}`;
        const method = (p.per_1000_method||"").trim();
        if (method){
          const label = method.charAt(0).toUpperCase() + method.slice(1);
          html += `<br>Method: ${label}`;
        }
        return html;
      }


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

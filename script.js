
// ---------- Static options (fully offline) ----------
const META = {
  regions: [
    { value: "ap-south-1", label: "AWS Mumbai / Azure Central India / GCP asia-south1 / OCI ap-mumbai-1" },
    { value: "us-east-1",  label: "AWS N. Virginia / Azure East US / GCP us-east1 / OCI us-ashburn-1" }
  ],
  os:   [{ value: "Linux" }, { value: "Windows" }],
  vcpu: [1, 2, 4, 8, 16],
  ram:  [1, 2, 4, 8, 16, 32]
};

// Region translation table for each provider
const REGION_MAP = {
  "ap-south-1": { aws: "ap-south-1", azure: "centralindia", gcp: "asia-south1", oci: "ap-mumbai-1" },
  "us-east-1":  { aws: "us-east-1",  azure: "eastus",       gcp: "us-east1",    oci: "us-ashburn-1" }
};

// Local JSON files (snapshots)
const FILES = {
  aws:   "data/aws-ec2.json",
  azure: "data/azure-vm.json",
  gcp:   "data/gcp-compute.json",
  oci:   "data/oci-compute.json"
};

// Simple SKU/shape suggestions based on vCPU (you can refine by RAM)
function suggestAwsInstance(vcpu) {
  if (vcpu <= 2) return "t3.small";
  if (vcpu <= 4) return "t3.medium";
  return "m6a.xlarge";
}
function suggestAzureSku(vcpu) {
  if (vcpu <= 2) return "Standard_B2ms";
  if (vcpu <= 4) return "Standard_D4s_v5";
  return "Standard_D8s_v5";
}
function suggestGcpMachine(vcpu) {
  if (vcpu <= 2) return "e2-standard-2";
  if (vcpu <= 4) return "e2-standard-4";
  return "n2-standard-8";
}
function suggestOciFlex(vcpu, ramGB) {
  // Snapshot files already contain computed lines;
  // this function only suggests a label for display if needed.
  const ocpu = Math.max(1, Math.round(vcpu / 2));
  return `VM.Standard.E5.Flex (${ocpu} OCPU, ${ramGB}GB)`;
}

const fmtMoney = n => (n == null || isNaN(n)) ? "-" : `$${n.toFixed(4)}`;
const monthFromHour = x => (x == null || isNaN(x)) ? null : (x * 730);

document.addEventListener("DOMContentLoaded", () => {
  // Populate selects
  fillSelect("region", META.regions.map(x => ({ value: x.value, text: x.label })));
  fillSelect("os",     META.os.map(x => ({ value: x.value, text: x.value })));
  fillSelect("cpu",    META.vcpu.map(v => ({ value: v, text: v })));
  fillSelect("ram",    META.ram.map(v => ({ value: v, text: v })));

  setSelectValue("region", "ap-south-1");
  setSelectValue("os", "Linux");
  setSelectValue("cpu", "2");
  setSelectValue("ram", "4");
});

function fillSelect(id, items) {
  const el = document.getElementById(id);
  el.innerHTML = "";
  items.forEach(it => {
    const opt = document.createElement("option");
    opt.value = it.value; opt.textContent = it.text;
    el.appendChild(opt);
  });
}
function setSelectValue(id, val) {
  const el = document.getElementById(id);
  const match = Array.from(el.options).find(o => o.value == val);
  if (match) el.value = val;
}
function setStatus(msg, level="info") {
  const el = document.getElementById("status");
  el.textContent = msg;
  el.className = "status" + (level==="error" ? " error" : "");
}

async function compare() {
  const btn = document.getElementById("compareBtn");
  btn.disabled = true; setStatus("Loading local price snapshots…");

  const regionKey = document.getElementById("region").value;
  const os       = document.getElementById("os").value.toLowerCase(); // linux|windows
  const vcpu     = Number(document.getElementById("cpu").value);
  const ram      = Number(document.getElementById("ram").value);
  const map      = REGION_MAP[regionKey];

  // Suggestions
  const want = {
    aws:   suggestAwsInstance(vcpu),
    azure: suggestAzureSku(vcpu),
    gcp:   suggestGcpMachine(vcpu),
    oci:   suggestOciFlex(vcpu, ram)
  };

  try {
    const [aws, azure, gcp, oci] = await Promise.all([
      loadSnapshot(FILES.aws),
      loadSnapshot(FILES.azure),
      loadSnapshot(FILES.gcp),
      loadSnapshot(FILES.oci)
    ]);

    // Select the best matching entry: region + os + suggested sku where possible,
    // then fall back to closest vcpu/memory in that region+os.
    const pick = (snapshot, provider, region, os, skuHint, v, m) => {
      const list = (snapshot.entries || []).filter(e =>
        e.region === region && e.os === os
      );
      // Try exact sku match first
      let best = list.find(e => e.sku === skuHint);
      if (!best) {
        // Heuristic: minimize (|vcpu-v| + |mem-m|)
        best = list.reduce((acc, e) => {
          const score = Math.abs((e.vcpu||0) - v) + Math.abs((e.memoryGB||0) - m/2);
          return (acc == null || score < acc.score) ? { e, score } : acc;
        }, null);
        best = best?.e || null;
      }
      return best;
    };

    const awsPick   = pick(aws,   "aws",   map.aws,   os, want.aws,   vcpu, ram);
    const azurePick = pick(azure, "azure", map.azure, os, want.azure, vcpu, ram);
    const gcpPick   = pick(gcp,   "gcp",   map.gcp,   os, want.gcp,   vcpu, ram);
    const ociPick   = pick(oci,   "oci",   map.oci,   os, want.oci,   vcpu, ram);

    // Update UI
    setPanel("aws",   awsPick,   want.aws,   vcpu, ram);
    setPanel("az",    azurePick, want.azure, vcpu, ram);
    setPanel("gcp",   gcpPick,   want.gcp,   vcpu, ram);
    setPanel("oci",   ociPick,   want.oci,   vcpu, ram);

    setStatus("Done ✓");
  } catch (e) {
    console.error(e);
    setStatus("Failed to load local JSON snapshots.", "error");
    alert("Snapshot load error. Confirm /data/*.json exists and is valid.");
  } finally {
    btn.disabled = false;
  }
}

function setPanel(prefix, pick, skuHint, vcpu, ram) {
  const instEl  = document.getElementById(`${prefix}Instance`);
  const cpuEl   = document.getElementById(`${prefix}Cpu`);
  const ramEl   = document.getElementById(`${prefix}Ram`);
  const priceEl = document.getElementById(`${prefix}Price`); // hr
  const moEl    = document.getElementById(`${prefix}Monthly`);

  if (!pick) {
    instEl.textContent  = `Instance: (no match; tried ${skuHint})`;
    cpuEl.textContent   = `vCPU: ${vcpu}`;
    ramEl.textContent   = `RAM: ${ram} GB`;
    priceEl.textContent = "Price/hr: -";
    moEl.textContent    = "≈ Monthly: -";
    return;
  }

  const month = monthFromHour(pick.pricePerHourUSD);
  instEl.textContent  = `Instance: ${pick.sku}`;
  cpuEl.textContent   = `vCPU: ${pick.vcpu ?? vcpu}`;
  ramEl.textContent   = `RAM: ${pick.memoryGB ?? ram} GB`;
  priceEl.textContent = `Price/hr: ${fmtMoney(pick.pricePerHourUSD)}`;
  moEl.textContent    = `≈ Monthly: ${fmtMoney(month)}`;
}

async function loadSnapshot(path) {
  const r = await fetch(path + `?v=20260123-1`, { cache: "no-store" });
  if (!r.ok) throw new Error(`Failed to load ${path}: ${r.status}`);
  return r.json();
}

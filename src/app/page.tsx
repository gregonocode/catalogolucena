// src/app/page.tsx
"use client";

import React from "react";
import Link from "next/link";
import { Menu, Search, ShoppingCart, Heart, AlertTriangle } from "lucide-react";
import { supabaseBrowser } from "@/lib/supabase-browser";

// Accent color
const ACCENT = "#01A920";

/* ===================== Tipos ===================== */
type Category = { id: string; name: string; slug: string };

type ProductRow = {
  id: string;
  title: string;
  price_cents: number;
  amount: number | null; // pode ser null (estoque base desconhecido para público/RLS)
  product_images: { storage_path: string; is_primary: boolean }[] | null;
  product_categories: { category_id: string }[] | null;
};

type ProductCard = {
  id: string;
  title: string;
  price_cents: number;
  imageUrl: string | null;
  categoryIds: string[];
  baseAmount: number;        // valor numérico para cálculos (0 quando amount=null)
  baseKnown: boolean;        // true se products.amount é conhecido (não-null)
  totalAmount: number;       // soma das variantes (ou baseAmount)
  totalKnown: boolean;       // true se conseguimos ler estoque das variantes para este produto
};

type SizeKey = "P" | "M" | "G" | "GG";
const SIZE_LABELS: SizeKey[] = ["P", "M", "G", "GG"];

type SizeEntry = { key: SizeKey; optionId: string; amount: number };

type ColorEntry = { id: string; name: string; hex: string | null };
type QuickAddMode = "simple" | "size-only" | "size-color";

type QuickAddData = {
  productId: string;
  title: string;
  price_cents: number;
  imageUrl: string | null;
  mode: QuickAddMode;
  sizes: SizeEntry[];          // P/M/G/GG (pode estar vazio)
  colors: ColorEntry[];        // só vem quando mode === "size-color"
  // novos campos para validação por combinação
  stockByCombo?: Record<string, number>; // `${sizeId}::${colorId}` -> amount
  sizeIdByKey?: Record<SizeKey, string>; // "P"|"M"|"G"|"GG" -> optionId
};

type CartItemVariant = {
  kind: "variant";
  id: string; // `${product_id}:${size_option_id}` ou `${product_id}:${size_option_id}:${color_option_id}`
  product_id: string;
  variant_option_id: string; // tamanho
  size: SizeKey;
  title: string;
  price_cents: number;
  imageUrl: string | null;
  qty: number;
  // campos de cor (quando houver)
  color_option_id?: string | null;
  color_label?: string | null;
  max?: number; // estoque conhecido para limitar incremento local (linha de tamanho)
};
type CartItemSimple = {
  kind: "simple";
  id: string; // `${product_id}`
  product_id: string;
  title: string;
  price_cents: number;
  imageUrl: string | null;
  qty: number;
  max?: number; // estoque do produto (quando conhecido)
};
type CartItem = CartItemVariant | CartItemSimple;

type StoreSettings = {
  id: string;
  store_name: string | null;
  whatsapp_e164: string | null;
  link_banner: string | null;
};

/* ===================== Utils ===================== */
const CART_KEY = "cart_v2_sizes";
const norm = (s: string) => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();

function formatPrice(cents: number) {
  return (cents / 100).toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL",
    minimumFractionDigits: 2,
  });
}

function normalizePhoneForWa(me: string | null): string | null {
  if (!me) return null;
  const digits = me.replace(/\D/g, "");
  if (!digits) return null;
  return digits.startsWith("55") ? digits : `55${digits}`;
}

/* ===================== Página ===================== */
export default function Page() {
  const supabase = supabaseBrowser();

  const [loading, setLoading] = React.useState(true);
  const [submitting, setSubmitting] = React.useState(false);
  const [err, setErr] = React.useState<string | null>(null);

  // Dados
  const [categories, setCategories] = React.useState<Category[]>([]);
  const [products, setProducts] = React.useState<ProductCard[]>([]);

  // Store settings
  const [storeName, setStoreName] = React.useState<string>("Sua Loja");
  const [whatsE164, setWhatsE164] = React.useState<string | null>(null);
  const [bannerUrl, setBannerUrl] = React.useState<string | null>(null);

  // Filtro categoria
  const [activeCat, setActiveCat] = React.useState<string | null>(null);

  // Carrinho (MVP localStorage)
  const [cart, setCart] = React.useState<CartItem[]>([]);
  const [cartOpen, setCartOpen] = React.useState(false);

  // Quick Add (modal)
  const [quickAddOpen, setQuickAddOpen] = React.useState(false);
  const [quickAdd, setQuickAdd] = React.useState<QuickAddData | null>(null);
  const [qaSelectedSize, setQaSelectedSize] = React.useState<SizeKey | null>(null);
  const [qaSelectedColor, setQaSelectedColor] = React.useState<string | null>(null); // optionId da cor
  const [qaQty, setQaQty] = React.useState(1);

  React.useEffect(() => {
    try {
      const raw = localStorage.getItem(CART_KEY);
      if (raw) setCart(JSON.parse(raw));
    } catch {}
  }, []);
  React.useEffect(() => {
    try {
      localStorage.setItem(CART_KEY, JSON.stringify(cart));
    } catch {}
  }, [cart]);

  // Helpers
  function orderCode(id: number) {
    return `#${String(id).padStart(5, "0")}`;
  }

  const cartCount = cart.reduce((sum, it) => sum + it.qty, 0);
  const cartTotal = cart.reduce((sum, it) => sum + it.price_cents * it.qty, 0);

  // Carregar categorias + produtos + store_settings + variantes/estoque
  React.useEffect(() => {
    let ignore = false;
    (async () => {
      setLoading(true);
      setErr(null);

      const catsPromise = supabase
        .from("categories")
        .select("id, name, slug")
        .order("created_at", { ascending: false });

      const prodsPromise = supabase
        .from("products")
        .select(
          `id, title, price_cents, amount,
           product_images(storage_path, is_primary),
           product_categories(category_id)`
        )
        .eq("active", true)
        .order("created_at", { ascending: false })
        .limit(60);

      const settingsPromise = supabase
        .from("store_settings")
        .select("id, store_name, whatsapp_e164, link_banner, created_at")
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      const [catsRes, prodsRes, settingsRes] = await Promise.all([
        catsPromise,
        prodsPromise,
        settingsPromise,
      ]);

      if (ignore) return;

      // categorias
      if (catsRes.error) {
        setErr(catsRes.error.message);
        setLoading(false);
        return;
      }
      setCategories((catsRes.data ?? []) as Category[]);

      // produtos
      if (prodsRes.error) {
        setErr(prodsRes.error.message);
        setLoading(false);
        return;
      }

      const rows = (prodsRes.data ?? []) as ProductRow[];

      const baseMapped: ProductCard[] = rows.map((p) => {
        const primary =
          (p.product_images || []).find((img) => img.is_primary) ||
          (p.product_images || [])[0] ||
          null;
        let imageUrl: string | null = null;
        if (primary?.storage_path) {
          const { data } = supabase.storage.from("produtos").getPublicUrl(primary.storage_path);
          imageUrl = data.publicUrl;
        }
        const categoryIds = (p.product_categories || []).map((pc) => pc.category_id);
        const baseKnown = p.amount !== null && p.amount !== undefined;
        const baseAmount = baseKnown ? (p.amount as number) : 0;

        return {
          id: p.id,
          title: p.title,
          price_cents: p.price_cents,
          imageUrl,
          categoryIds,
          baseAmount,
          baseKnown,
          totalAmount: baseAmount, // recalculado com variantes se conhecidas
          totalKnown: baseKnown,   // provisório; substituído se variantes forem conhecidas
        };
      });

      setProducts(baseMapped);

      // === buscar tamanhos/estoque por produto ===
      const productIds = rows.map((r) => r.id);
      if (productIds.length) {
        // 1) grupos "Tamanho" e "Cor" desses produtos
        const { data: groupsData, error: groupsErr } = await supabase
          .from("variant_groups")
          .select("id, product_id, name")
          .in("product_id", productIds);
        if (groupsErr) {
          setErr(groupsErr.message);
          setLoading(false);
          return;
        }
        const allGroups = (groupsData ?? []) as { id: string; product_id: string; name: string }[];
        const sizeGroups = allGroups.filter((g) => norm(g.name) === "tamanho");
        const colorGroups = allGroups.filter((g) => norm(g.name) === "cor");

        const sizeGroupIds = sizeGroups.map((g) => g.id);
        const colorGroupIds = colorGroups.map((g) => g.id);

        // 2) opções P/M/G/GG de Tamanho e opções de Cor (com code!)
        type VO = { id: string; variant_group_id: string; value: string; code?: string | null };
        let sizeOpts: VO[] = [];
        if (sizeGroupIds.length) {
          const { data: opt, error: optErr } = await supabase
            .from("variant_options")
            .select("id, variant_group_id, value")
            .in("variant_group_id", sizeGroupIds)
            .in("value", SIZE_LABELS);
          if (optErr) {
            setErr(optErr.message);
            setLoading(false);
            return;
          }
          sizeOpts = (opt ?? []) as VO[];
        }

        let colorOpts: VO[] = [];
        if (colorGroupIds.length) {
          const { data: optC, error: optCErr } = await supabase
            .from("variant_options")
            .select("id, variant_group_id, value, code, position")
            .in("variant_group_id", colorGroupIds)
            .order("position", { ascending: true });
          if (optCErr) {
            setErr(optCErr.message);
            setLoading(false);
            return;
          }
          colorOpts = (optC ?? []) as VO[];
        }

        // Mapas auxiliares
        const sizeGroupToProduct = new Map(sizeGroups.map((g) => [g.id, g.product_id] as const));
        const colorGroupToProduct = new Map(colorGroups.map((g) => [g.id, g.product_id] as const));

        const sizeOptsByProduct = new Map<string, VO[]>();
        for (const o of sizeOpts) {
          const pid = sizeGroupToProduct.get(o.variant_group_id);
          if (!pid) continue;
          const arr = sizeOptsByProduct.get(pid) ?? [];
          arr.push(o);
          sizeOptsByProduct.set(pid, arr);
        }

        const colorOptsByProduct = new Map<string, VO[]>();
        for (const o of colorOpts) {
          const pid = colorGroupToProduct.get(o.variant_group_id);
          if (!pid) continue;
          const arr = colorOptsByProduct.get(pid) ?? [];
          arr.push(o);
          colorOptsByProduct.set(pid, arr);
        }

        // 3) Ler SETS para todos os produtos (suporta size+color)
        type SetRow = {
          id: string;
          product_id: string;
          amount: number | null;
          product_variant_set_options: { variant_option_id: string }[];
        };

        const { data: setsData, error: setsErr } = await supabase
          .from("product_variant_sets")
          .select(`
            id, product_id, amount,
            product_variant_set_options ( variant_option_id )
          `)
          .in("product_id", productIds);
        if (setsErr) {
          setErr(setsErr.message);
          setLoading(false);
          return;
        }
        const allSets = (setsData ?? []) as SetRow[];

        // Construir totais e tamanhos a partir dos SETS
        const totalsFromSets: Record<string, number> = {};
        const sizesFromSets: Record<string, SizeEntry[]> = {};
        const sizeOptIndexByProduct = new Map<string, Map<string, SizeKey>>(); // pid -> (sizeOptionId -> SizeKey)

        const sortBySize = (a: { value: string }, b: { value: string }) =>
          SIZE_LABELS.indexOf(a.value as SizeKey) - SIZE_LABELS.indexOf(b.value as SizeKey);

        for (const pid of productIds) {
          const sizeOptions = (sizeOptsByProduct.get(pid) ?? []).sort(sortBySize);
          const indexMap = new Map<string, SizeKey>();
          for (const so of sizeOptions) indexMap.set(so.id, so.value as SizeKey);
          sizeOptIndexByProduct.set(pid, indexMap);

          // inicializa linhas de tamanho com amount 0
          sizesFromSets[pid] = sizeOptions.map((o) => ({
            key: o.value as SizeKey,
            optionId: o.id,
            amount: 0,
          }));
        }

        for (const s of allSets) {
          totalsFromSets[s.product_id] = (totalsFromSets[s.product_id] ?? 0) + Number(s.amount ?? 0);
          const sizeIndex = sizeOptIndexByProduct.get(s.product_id);
          if (!sizeIndex) continue;

          const optIds = s.product_variant_set_options?.map((o) => o.variant_option_id) ?? [];
          const sizeOptId = optIds.find((id) => sizeIndex.has(id));
          if (!sizeOptId) continue;

          const arr = sizesFromSets[s.product_id] ?? [];
          const idx = arr.findIndex((e) => e.optionId === sizeOptId);
          if (idx >= 0) {
            arr[idx] = { ...arr[idx], amount: arr[idx].amount + Number(s.amount ?? 0) };
            sizesFromSets[s.product_id] = arr;
          }
        }

        // 4) Fallback: product_variants (tamanho-apenas)
        type PV = { product_id: string; variant_option_id: string; amount: number | null };
        let pvRows: PV[] = [];
        const productsWithoutSets = productIds.filter((pid) => !(pid in totalsFromSets));
        const sizeOptIds = sizeOpts.map((o) => o.id);
        if (productsWithoutSets.length && sizeOptIds.length) {
          const { data: pv, error: pvErr } = await supabase
            .from("product_variants")
            .select("product_id, variant_option_id, amount")
            .in("product_id", productsWithoutSets)
            .in("variant_option_id", sizeOptIds);
          if (pvErr) {
            setErr(pvErr.message);
            setLoading(false);
            return;
          }
          pvRows = (pv ?? []) as PV[];

          for (const pid of productsWithoutSets) {
            const pidSizeOpts = sizeOptsByProduct.get(pid) ?? [];
            const arr: SizeEntry[] = pidSizeOpts
              .map((o) => {
                const amt = pvRows.find((r) => r.product_id === pid && r.variant_option_id === o.id)?.amount ?? 0;
                return { key: o.value as SizeKey, optionId: o.id, amount: Number(amt ?? 0) };
              })
              .sort((a, b) => SIZE_LABELS.indexOf(a.key) - SIZE_LABELS.indexOf(b.key));
            sizesFromSets[pid] = arr;
          }
        }

        // 5) Consolidar nos cards (sem estados extras)
        const totals: Record<string, number> = {};
        const knownRecord: Record<string, boolean> = {};

        for (const pid of productIds) {
          const fromSets = pid in totalsFromSets;
          const fromPV = pvRows.some((r) => r.product_id === pid);

          knownRecord[pid] = fromSets || fromPV;

          if (fromSets) {
            totals[pid] = totalsFromSets[pid] ?? 0;
          } else if (fromPV) {
            const arr = sizesFromSets[pid] ?? [];
            totals[pid] = arr.reduce((s, e) => s + e.amount, 0);
          }
        }

        setProducts((prev) =>
          prev.map((p) => {
            const variantsKnown = knownRecord[p.id] ?? false;
            if (variantsKnown) {
              const total = typeof totals[p.id] === "number" ? totals[p.id] : 0;
              return { ...p, totalAmount: total, totalKnown: true };
            }
            return { ...p, totalAmount: p.baseAmount, totalKnown: p.baseKnown };
          })
        );
      }

      // settings
      if (!settingsRes.error && settingsRes.data) {
        const s = settingsRes.data as StoreSettings;
        setStoreName(s.store_name || "Sua Loja");
        setWhatsE164(s.whatsapp_e164 || null);
        setBannerUrl(s.link_banner || null);
      }

      setLoading(false);
    })();
    return () => {
      ignore = true;
    };
  }, [supabase]);

  const filtered = React.useMemo(() => {
    if (!activeCat) return products;
    return products.filter((p) => p.categoryIds.includes(activeCat));
  }, [products, activeCat]);

  // ===== Helpers do modal (estoque por combinação) =====
  function comboQty(sizeId: string | null, colorId: string | null): number {
    if (!quickAdd) return 0;

    const stockByCombo = quickAdd.stockByCombo || {};
    const sizes = quickAdd.sizes || [];
    const baseAmount = 0; // não usamos base para size+color; mantido para fallback

    if (!Object.keys(stockByCombo).length) {
      // fallback sem grade de combinações: usa amount por tamanho (se houver)
      if (sizeId) {
        const entry = sizes.find((s) => s.optionId === sizeId);
        return entry?.amount ?? 0;
      }
      return baseAmount;
    }

    if (sizeId && colorId) {
      const k = `${sizeId}::${colorId}`;
      const v = stockByCombo[k];
      return typeof v === "number" ? Math.max(0, v) : 0;
    }

    // só cor: soma coluna
    if (!sizeId && colorId) {
      let sum = 0;
      for (const [k, v] of Object.entries(stockByCombo)) {
        if (k.endsWith(`::${colorId}`)) sum += v;
      }
      return Math.max(0, sum);
    }

    // só tamanho: soma linha
    if (sizeId && !colorId) {
      let sum = 0;
      for (const [k, v] of Object.entries(stockByCombo)) {
        if (k.startsWith(`${sizeId}::`)) sum += v;
      }
      return Math.max(0, sum);
    }

    // nada selecionado: soma total
    return Object.values(stockByCombo).reduce((s, n) => s + n, 0);
  }

  function handleSelectSize(sz: SizeKey) {
    if (!quickAdd) return;
    const sizes = quickAdd.sizes;
    const found = sizes.find((s) => s.key === sz) || null;
    const newSizeId = found?.optionId ?? null;

    // se já há cor escolhida, só permite se a combinação tiver estoque
    if (qaSelectedColor && newSizeId) {
      const qty = comboQty(newSizeId, qaSelectedColor);
      if (qty <= 0) {
        alert("Não há estoque para essa combinação de tamanho e cor.");
        return; // bloqueia seleção inválida
      }
    }

    setQaSelectedSize(sz);
    setQaQty(1);
  }

  function handleSelectColor(colorId: string) {
    if (!quickAdd) return;

    // se já há tamanho escolhido, só permite se a combinação tiver estoque
    if (qaSelectedSize && quickAdd.sizeIdByKey) {
      const sizeId = quickAdd.sizeIdByKey[qaSelectedSize];
      if (sizeId) {
        const qty = comboQty(sizeId, colorId);
        if (qty <= 0) {
          alert("Não há estoque para essa combinação de tamanho e cor.");
          return; // bloqueia seleção inválida
        }
      }
    }

    setQaSelectedColor(colorId);
    setQaQty(1);
  }

  // ====== Quick Add (abrir modal) ======
  async function openQuickAdd(p: ProductCard) {
    // dados base do card
    const base: Omit<QuickAddData, "mode" | "sizes" | "colors"> = {
      productId: p.id,
      title: p.title,
      price_cents: p.price_cents,
      imageUrl: p.imageUrl,
    };

    const normalize = (s: string) =>
      s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();

    // 1) Buscar grupos do produto
    const { data: groups, error: gErr } = await supabase
      .from("variant_groups")
      .select("id, name")
      .eq("product_id", p.id);
    if (gErr) {
      // fallback simples
      setQuickAdd({ ...base, mode: "simple", sizes: [], colors: [] });
      setQaSelectedSize(null);
      setQaSelectedColor(null);
      setQaQty(1);
      setQuickAddOpen(true);
      return;
    }

    const sizeGroup = (groups ?? []).find((g) => normalize(g.name) === "tamanho") || null;
    const colorGroup = (groups ?? []).find((g) => normalize(g.name) === "cor") || null;

    // 2) Sem nenhum grupo → simple
    if (!sizeGroup && !colorGroup) {
      setQuickAdd({ ...base, mode: "simple", sizes: [], colors: [] });
      setQaSelectedSize(null);
      setQaSelectedColor(null);
      setQaQty(1);
      setQuickAddOpen(true);
      return;
    }

    // Helpers de busca de opções
    type VOSize = { id: string; value: string; variant_group_id: string };
    type VariantOptionColorRow = { id: string; value: string; code: string | null; position: number };

    const fetchSizeOptions = async (): Promise<VOSize[]> => {
      if (!sizeGroup) return [];
      const { data } = await supabase
        .from("variant_options")
        .select("id, value, variant_group_id")
        .eq("variant_group_id", sizeGroup.id)
        .in("value", SIZE_LABELS);
      return (data ?? []) as VOSize[];
    };

    const fetchColorOptions = async (): Promise<ColorEntry[]> => {
      if (!colorGroup) return [];
      const { data } = await supabase
        .from("variant_options")
        .select("id, value, code, position")
        .eq("variant_group_id", colorGroup.id)
        .order("position", { ascending: true });
      const rows = (data ?? []) as VariantOptionColorRow[];
      return rows.map((o) => ({
        id: o.id,
        name: o.value,
        hex: o.code ?? null,
      }));
    };

    // 3A) MODO: tamanho + cor  → somar via product_variant_sets por tamanho e montar mapa de combinações
    if (sizeGroup && colorGroup) {
      const sizeOptions = await fetchSizeOptions();
      const sizeIds = sizeOptions.map((o) => o.id);

      type SetRow = {
        id: string;
        amount: number | null;
        product_variant_set_options: { variant_option_id: string }[];
      };
      const { data: sets } = await supabase
        .from("product_variant_sets")
        .select("id, amount, product_variant_set_options(variant_option_id)")
        .eq("product_id", p.id);

      // soma por tamanho e também por combinação (size::color)
      const sumBySize = new Map<string, number>();
      const stockByCombo: Record<string, number> = {};

      const colors = await fetchColorOptions();
      const colorIds = new Set(colors.map((c) => c.id));

      (sets ?? []).forEach((s: SetRow) => {
        const optIds = (s.product_variant_set_options ?? []).map((o) => o.variant_option_id);

        const sizeId = optIds.find((id) => sizeIds.includes(id));
        const colorId = optIds.find((id) => colorIds.has(id));

        const amt = Number(s.amount ?? 0);

        if (sizeId) {
          sumBySize.set(sizeId, (sumBySize.get(sizeId) ?? 0) + amt);
        }
        if (sizeId && colorId) {
          const key = `${sizeId}::${colorId}`;
          stockByCombo[key] = (stockByCombo[key] ?? 0) + amt;
        }
      });

      const sizes: SizeEntry[] = sizeOptions
        .map((o) => ({
          key: o.value as SizeKey,
          optionId: o.id,
          amount: sumBySize.get(o.id) ?? 0,
        }))
        .sort((a, b) => SIZE_LABELS.indexOf(a.key) - SIZE_LABELS.indexOf(b.key));

      const sizeIdByKey: Record<SizeKey, string> = Object.fromEntries(
        sizes.map((s) => [s.key, s.optionId])
      ) as Record<SizeKey, string>;

      setQuickAdd({
        ...base,
        mode: "size-color",
        sizes,
        colors,
        stockByCombo,
        sizeIdByKey,
      });

      const withStock = sizes.filter((s) => s.amount > 0);
      setQaSelectedSize(withStock.length === 1 ? withStock[0].key : null);
      setQaSelectedColor(colors.length === 1 ? colors[0].id : null);
      setQaQty(1);
      setQuickAddOpen(true);
      return;
    }

    // 3B) MODO: apenas tamanho → ler product_variants (estoque por tamanho)
    if (sizeGroup && !colorGroup) {
      const sizeOptions = await fetchSizeOptions();
      const sizeIds = sizeOptions.map((o) => o.id);

      type PV = { variant_option_id: string; amount: number | null };
      let pvRows: PV[] = [];
      if (sizeIds.length) {
        const { data } = await supabase
          .from("product_variants")
          .select("variant_option_id, amount")
          .eq("product_id", p.id)
          .in("variant_option_id", sizeIds);
        pvRows = (data ?? []) as PV[];
      }

      const sizes: SizeEntry[] = sizeOptions
        .map((o) => {
          const key = o.value as SizeKey;
          const amt = pvRows.find((r) => r.variant_option_id === o.id)?.amount ?? 0;
          return { key, optionId: o.id, amount: Number(amt ?? 0) };
        })
        .sort((a, b) => SIZE_LABELS.indexOf(a.key) - SIZE_LABELS.indexOf(b.key));

      setQuickAdd({ ...base, mode: "size-only", sizes, colors: [] });

      const withStock = sizes.filter((s) => s.amount > 0);
      setQaSelectedSize(withStock.length === 1 ? withStock[0].key : null);
      setQaSelectedColor(null);
      setQaQty(1);
      setQuickAddOpen(true);
      return;
    }

    // 3C) (fallback raro) só cor → trata como simple (sem grade de tamanho)
    const colors = await fetchColorOptions();
    setQuickAdd({ ...base, mode: "simple", sizes: [], colors });
    setQaSelectedSize(null);
    setQaSelectedColor(colors.length === 1 ? colors[0].id : null);
    setQaQty(1);
    setQuickAddOpen(true);
  }

  // ====== Confirmar do modal ======
  function confirmQuickAdd() {
    if (!quickAdd) return;
    const p = quickAdd;

    // SIMPLE
    if (p.mode === "simple") {
      const prod = products.find((x) => x.id === p.productId);
      if (!prod?.baseKnown || prod.baseAmount <= 0) {
        alert("Produto esgotado no momento.");
        return;
      }
      const max = prod.baseAmount;

      setCart((c) => {
        const i = c.findIndex((x) => x.id === p.productId);
        if (i >= 0) {
          const next = [...c];
          const cur = next[i] as CartItemSimple;
          next[i] = { ...cur, qty: Math.min(cur.qty + qaQty, max), max };
          return next;
        }
        const newItem: CartItemSimple = {
          kind: "simple",
          id: p.productId,
          product_id: p.productId,
          title: p.title,
          price_cents: p.price_cents,
          imageUrl: p.imageUrl,
          qty: Math.min(qaQty, max),
          max,
        };
        return [...c, newItem];
      });
      setQuickAddOpen(false);
      return;
    }

    // SIZE-ONLY
    if (p.mode === "size-only") {
      if (!qaSelectedSize) {
        alert("Selecione um tamanho.");
        return;
      }
      const entry = p.sizes.find((s) => s.key === qaSelectedSize);
      if (!entry || entry.amount <= 0) {
        alert("Este tamanho está esgotado.");
        return;
      }
      const max = entry.amount;
      const itemId = `${p.productId}:${entry.optionId}`;

      setCart((c) => {
        const i = c.findIndex((x) => x.id === itemId);
        if (i >= 0) {
          const next = [...c];
          const cur = next[i] as CartItemVariant;
          next[i] = { ...cur, qty: Math.min(cur.qty + qaQty, max), max };
          return next;
        }
        const newItem: CartItemVariant = {
          kind: "variant",
          id: itemId,
          product_id: p.productId,
          variant_option_id: entry.optionId,
          size: qaSelectedSize,
          title: p.title,
          price_cents: p.price_cents,
          imageUrl: p.imageUrl,
          qty: Math.min(qaQty, max),
          max,
        };
        return [...c, newItem];
      });
      setQuickAddOpen(false);
      return;
    }

    // SIZE-COLOR
    if (p.mode === "size-color") {
      if (!qaSelectedSize) {
        alert("Selecione um tamanho.");
        return;
      }
      if (!qaSelectedColor) {
        alert("Selecione uma cor.");
        return;
      }
      const entry = p.sizes.find((s) => s.key === qaSelectedSize);
      if (!entry) {
        alert("Tamanho inválido.");
        return;
      }

      // valida a COMBINAÇÃO antes de adicionar
      const sizeOptId = entry.optionId;
      const colorOptId = qaSelectedColor;
      const availableCombo = comboQty(sizeOptId, colorOptId);
      if (availableCombo <= 0) {
        alert("Esta combinação de tamanho e cor está esgotada.");
        return;
      }

      const colorLabel = p.colors.find((c) => c.id === colorOptId)?.name ?? null;

      // usamos ID com cor para não unificar itens de cores diferentes
      const itemId = `${p.productId}:${sizeOptId}:${colorOptId}`;
      const max = entry.amount; // limite local pela linha de tamanho

      setCart((c) => {
        const i = c.findIndex((x) => x.id === itemId);
        if (i >= 0) {
          const next = [...c];
          const cur = next[i] as CartItemVariant;
          next[i] = { ...cur, qty: Math.min(cur.qty + qaQty, max), max };
          return next;
        }
        const newItem: CartItemVariant = {
          kind: "variant",
          id: itemId,
          product_id: p.productId,
          variant_option_id: sizeOptId,
          size: qaSelectedSize,
          title: p.title,
          price_cents: p.price_cents,
          imageUrl: p.imageUrl,
          qty: Math.min(qaQty, max),
          max,
          color_option_id: colorOptId,
          color_label: colorLabel,
        };
        return [...c, newItem];
      });
      setQuickAddOpen(false);
    }
  }

  // ====== Checkout ======
  function buildWhatsappText(orderId: number): string {
    const lines: string[] = [];
    lines.push(`Olá! Quero finalizar o pedido *${orderCode(orderId)}* na *${storeName}*.`);
    lines.push("");
    lines.push("Itens:");
    cart.forEach((it) => {
      const base = `• ${it.qty} x ${it.title}`;
      const size = it.kind === "variant" ? ` — Tam: ${it.size}` : "";
      const color =
        it.kind === "variant" && it.color_label ? ` — Cor: ${it.color_label}` : "";
      const unit = formatPrice(it.price_cents);
      const total = formatPrice(it.price_cents * it.qty);
      lines.push(`${base}${size}${color} — ${unit} = ${total}`);
    });
    lines.push("");
    lines.push(`*Total:* ${formatPrice(cartTotal)}`);
    lines.push("");
    lines.push("Por favor, me informe forma de pagamento e prazo de entrega.");
    return lines.join("\n");
  }

  async function createPendingOrder() {
    const { data: order, error: orderErr } = await supabase
      .from("orders")
      .insert({})
      .select("id")
      .single<{ id: number }>();
    if (orderErr) throw orderErr;

    const itemsPayload = cart.map((it) => {
      if (it.kind === "variant") {
        return {
          order_id: order.id,
          product_id: it.product_id,
          variant_option_id: it.variant_option_id,
          size_label: it.size,
          quantity: it.qty,
          price_cents: it.price_cents,
          color_option_id: it.color_option_id ?? null,
          color_label: it.color_label ?? null,
        };
      }
      return {
        order_id: order.id,
        product_id: it.product_id,
        quantity: it.qty,
        price_cents: it.price_cents,
      };
    });
    const { error: itemsErr } = await supabase.from("order_items").insert(itemsPayload);
    if (itemsErr) throw itemsErr;

    return order.id;
  }

  async function handleCheckout() {
    if (cart.length === 0 || submitting) return;

    // Separar por tipo
    const withVariant = cart.filter((c): c is CartItemVariant => c.kind === "variant");
    const sizeColorItems = withVariant.filter((c) => c.color_option_id); // tamanho+cor
    const sizeOnlyItems = withVariant.filter((c) => !c.color_option_id); // apenas tamanho
    const noVariant = cart.filter((c): c is CartItemSimple => c.kind === "simple");

    // ===== VARIANTES: apenas tamanho (product_variants) =====
    if (sizeOnlyItems.length) {
      const variantIds = sizeOnlyItems.map((c) => c.variant_option_id);
      const { data: fresh, error: freshErr } = await supabase
        .from("product_variants")
        .select("variant_option_id, amount")
        .in("variant_option_id", variantIds);
      if (freshErr) {
        alert("Erro ao validar estoque (tamanhos). Tente novamente.");
        return;
      }
      const stockMap = new Map<string, number>(
        (fresh ?? []).map((r: { variant_option_id: string; amount: number | null }) => [
          r.variant_option_id,
          Number(r.amount ?? 0),
        ])
      );
      for (const it of sizeOnlyItems) {
        const available = stockMap.get(it.variant_option_id) ?? 0;
        if (available <= 0) {
          alert(`"${it.title}" (Tam ${it.size}) está esgotado. Remova do carrinho para continuar.`);
          return;
        }
        if (it.qty > available) {
          alert(`Quantidade de "${it.title}" excede o estoque do tamanho (${available}). Ajuste o carrinho.`);
          return;
        }
      }
    }

    // ===== VARIANTES: tamanho + cor (product_variant_sets) =====
    if (sizeColorItems.length) {
      // Buscar todos os SETS dos produtos envolvidos e montar um mapa (sizeId::colorId) -> amount
      const productIds = Array.from(new Set(sizeColorItems.map((i) => i.product_id)));
      const { data: sets, error: setsErr } = await supabase
        .from("product_variant_sets")
        .select("product_id, amount, product_variant_set_options(variant_option_id)")
        .in("product_id", productIds);
      if (setsErr) {
        alert("Erro ao validar estoque (combinações). Tente novamente.");
        return;
      }

      // Mapeia as opções usadas no carrinho
      const sizeIdsByProduct = new Map<string, Set<string>>();
      const colorIdsByProduct = new Map<string, Set<string>>();
      for (const it of sizeColorItems) {
        const sset = sizeIdsByProduct.get(it.product_id) ?? new Set<string>();
        sset.add(it.variant_option_id);
        sizeIdsByProduct.set(it.product_id, sset);

        if (it.color_option_id) {
          const cset = colorIdsByProduct.get(it.product_id) ?? new Set<string>();
          cset.add(it.color_option_id);
          colorIdsByProduct.set(it.product_id, cset);
        }
      }

      // Construir mapa de estoque por combinação
      const comboStock = new Map<string, number>(); // key: `${product_id}:${sizeId}:${colorId}`
      (sets ?? []).forEach((row: {
        product_id: string;
        amount: number | null;
        product_variant_set_options: { variant_option_id: string }[];
      }) => {
        const optIds = (row.product_variant_set_options ?? []).map((o) => o.variant_option_id);
        const sizeCandidates = sizeIdsByProduct.get(row.product_id);
        const colorCandidates = colorIdsByProduct.get(row.product_id);
        if (!sizeCandidates || !colorCandidates) return;

        const sizeId = optIds.find((id) => sizeCandidates.has(id));
        const colorId = optIds.find((id) => colorCandidates.has(id));
        if (!sizeId || !colorId) return;

        const key = `${row.product_id}:${sizeId}:${colorId}`;
        comboStock.set(key, (comboStock.get(key) ?? 0) + Number(row.amount ?? 0));
      });

      // Validar cada item do carrinho
      for (const it of sizeColorItems) {
        const colorId = it.color_option_id!;
        const key = `${it.product_id}:${it.variant_option_id}:${colorId}`;
        const available = comboStock.get(key) ?? 0;
        if (available <= 0) {
          const colorTxt = it.color_label ? `, Cor ${it.color_label}` : "";
          alert(`"${it.title}" (Tam ${it.size}${colorTxt}) está esgotado. Remova do carrinho para continuar.`);
          return;
        }
        if (it.qty > available) {
          const colorTxt = it.color_label ? `, Cor ${it.color_label}` : "";
          alert(
            `Quantidade de "${it.title}" (Tam ${it.size}${colorTxt}) excede o estoque da combinação (${available}). Ajuste o carrinho.`
          );
          return;
        }
      }
    }

    // ===== SIMPLES =====
    if (noVariant.length) {
      const prodIds = noVariant.map((c) => c.product_id);
      const { data: freshP, error: freshPErr } = await supabase
        .from("products")
        .select("id, amount")
        .in("id", prodIds);
      if (freshPErr) {
        alert("Erro ao validar estoque. Tente novamente.");
        return;
      }
      const stockMap = new Map<string, number | null>(
        (freshP ?? []).map((r: { id: string; amount: number | null }) => [r.id, r.amount])
      );
      for (const it of noVariant) {
        const available = stockMap.get(it.product_id);
        if (available === null || (available ?? 0) <= 0) {
          alert(`"${it.title}" está esgotado. Remova do carrinho para continuar.`);
          return;
        }
        if (it.qty > (available ?? 0)) {
          alert(`Quantidade de "${it.title}" excede o estoque (${available}). Ajuste o carrinho.`);
          return;
        }
      }
    }

    const phone = normalizePhoneForWa(whatsE164);
    if (!phone) {
      alert("WhatsApp da loja não configurado. Defina em Configurações da Loja.");
      return;
    }

    try {
      setSubmitting(true);
      setErr(null);

      const orderId = await createPendingOrder();

      const text = encodeURIComponent(buildWhatsappText(orderId));
      const url = `https://wa.me/${phone}?text=${text}`;
      setCart([]);
      window.open(url, "_blank");
      setCartOpen(false);
    } catch (e) {
      console.error(e);
      const msg = e instanceof Error ? e.message : "Erro ao finalizar pedido";
      setErr(msg);
      alert(msg);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="min-h-dvh bg-white text-gray-900">
      {/* Topbar */}
      <header className="sticky top-0 z-50 bg-white border-b border-gray-100">
        <div className="mx-auto max-w-screen-sm px-3 py-3 flex items-center justify-between">
          <button
            aria-label="Abrir menu"
            className="p-2 -ml-1 rounded-xl border border-gray-200 bg-white shadow-sm active:scale-[0.98]"
          >
            <Menu className="w-5 h-5" />
          </button>

          <div className="flex items-center gap-2 select-none">
            <div className="text-base font-semibold tracking-tight">{storeName || "Sua Loja"}</div>
          </div>

          <div className="flex items-center gap-2">
            <button aria-label="Pesquisar" className="p-2 rounded-xl border border-gray-200 bg-white shadow-sm active:scale-[0.98]">
              <Search className="w-5 h-5" />
            </button>
            <button
              aria-label="Abrir carrinho"
              onClick={() => setCartOpen(true)}
              className="relative p-2 rounded-xl border border-gray-200 bg-white shadow-sm active:scale-[0.98]"
            >
              <ShoppingCart className="w-5 h-5" />
              {cartCount > 0 && (
                <span
                  className="absolute -top-1 -right-1 min-w-[18px] h-[18px] px-1 rounded-full text-[10px] grid place-items-center text-white"
                  style={{ backgroundColor: ACCENT }}
                >
                  {cartCount}
                </span>
              )}
            </button>
          </div>
        </div>

        {/* Navbar de coleções */}
        <nav className="mx-auto max-w-screen-sm px-3 pb-3 overflow-x-auto scrollbar-none">
          <ul className="flex gap-2">
            <li>
              <button
                className={`whitespace-nowrap px-4 py-2 rounded-full border text-sm ${
                  activeCat === null ? "text-white border-transparent" : "text-gray-700 border-gray-200 bg-gray-50"
                }`}
                onClick={() => setActiveCat(null)}
                style={activeCat === null ? { backgroundColor: ACCENT } : {}}
              >
                Todas
              </button>
            </li>
            {categories.map((c) => (
              <li key={c.id}>
                <button
                  className={`whitespace-nowrap px-4 py-2 rounded-full border text-sm ${
                    activeCat === c.id ? "text-white border-transparent" : "text-gray-700 border-gray-200 bg-gray-50"
                  }`}
                  onClick={() => setActiveCat(c.id)}
                  style={activeCat === c.id ? { backgroundColor: ACCENT } : {}}
                >
                  {c.name}
                </button>
              </li>
            ))}
          </ul>
        </nav>
      </header>

      {/* Banner */}
      <section className="mx-auto max-w-screen-sm px-3 mt-3">
        {bannerUrl ? (
          <div className="rounded-2xl overflow-hidden border border-gray-100">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={bannerUrl} alt="Banner da loja" className="w-full h-36 object-cover" />
          </div>
        ) : (
          <div className="h-36 rounded-2xl bg-gray-100 border border-gray-100 flex items-center justify-center text-gray-500 text-sm">
            Banner
          </div>
        )}
      </section>

      {/* Grade de produtos */}
      <section className="mx-auto max-w-screen-sm px-3 mt-4 pb-24">
        {loading ? (
          <div className="p-3 rounded-xl border border-gray-100 bg-gray-50 text-sm text-gray-600">Carregando...</div>
        ) : err ? (
          <div className="p-3 rounded-xl border border-red-200 bg-red-50 text-sm text-red-700">{err}</div>
        ) : filtered.length === 0 ? (
          <div className="p-3 rounded-xl border border-gray-100 bg-gray-50 text-sm text-gray-600">Nenhum produto encontrado.</div>
        ) : (
          <div className="grid grid-cols-2 gap-3">
            {filtered.map((p) => {
              // considerar “conhecimento” do estoque total para mostrar esgotado
              const stockKnown = p.totalKnown;
              const totalOut = stockKnown && (p.totalAmount ?? 0) <= 0;
              const isLow = stockKnown && !totalOut && (p.totalAmount ?? 0) < 10;

              return (
                <article
                  key={p.id}
                  className="relative bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden active:scale-[0.998]"
                >
                  {/* Favoritar */}
                  <button
                    aria-label="Favoritar"
                    className="absolute right-2 top-2 z-10 p-1.5 rounded-full bg-white/90 backdrop-blur border border-gray-200 shadow-sm"
                  >
                    <Heart className="w-4 h-4" />
                  </button>

                  {/* Imagem (clicável) */}
                  <Link href={`/detalhes_produtos/${p.id}`}>
                    <div className="bg-gray-100 border-b border-gray-100 aspect-[3/4] w-full flex items-center justify-center overflow-hidden">
                      {p.imageUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={p.imageUrl} alt={p.title} className="w-full h-full object-cover" />
                      ) : (
                        <div className="w-16 h-16 rounded-lg bg-gray-200" />
                      )}
                    </div>
                  </Link>

                  {/* Conteúdo */}
                  <div className="p-2">
                    <h3 className="text-sm font-medium text-center line-clamp-2 min-h-[2.5rem]">{p.title}</h3>

                    <div className="mt-2 flex items-center justify-between">
                      <div className="text-sm font-semibold text-gray-900 whitespace-nowrap">
                        {formatPrice(p.price_cents)}
                      </div>

                      {totalOut ? (
                        <span className="px-2 py-1 rounded-full text-xs text-red-700 bg-red-50 border border-red-200">
                          ESGOTADO
                        </span>
                      ) : (
                        <button
                          aria-label="Abrir opções"
                          onClick={() => openQuickAdd(p)}
                          className="p-2 rounded-full shadow-sm"
                          style={{ backgroundColor: ACCENT }}
                          title="Escolher opções e adicionar"
                        >
                          <ShoppingCart className="w-4 h-4 text-white" />
                        </button>
                      )}
                    </div>

                    {/* Estoque baixo (total) — só quando conhecido */}
                    {stockKnown && !totalOut && isLow && (
                      <div className="mt-2 inline-flex items-center gap-1 text-[11px] text-orange-700 bg-orange-50 border border-orange-200 px-2 py-0.5 rounded-full">
                        <AlertTriangle className="w-3 h-3" />
                        <span>Restam {p.totalAmount} un.</span>
                      </div>
                    )}
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </section>

      {/* Drawer do carrinho */}
      {cartOpen && (
        <div className="fixed inset-0 z-[60]">
          <button
            aria-label="Fechar"
            onClick={() => setCartOpen(false)}
            className="absolute inset-0 bg-black/30 backdrop-blur-[1px]"
          />
          <aside className="absolute right-0 top-0 h-full w-[88%] max-w-[420px] bg-white shadow-2xl border-l border-gray-100 flex flex-col">
            <header className="p-3 border-b border-gray-100 flex items-center justify-between">
              <h2 className="text-base font-semibold">Seu carrinho</h2>
              <div className="text-sm text-gray-500">{cartCount} item(s)</div>
            </header>

            <div className="flex-1 overflow-auto p-3 space-y-2">
              {cart.length === 0 ? (
                <div className="p-3 rounded-xl border border-gray-100 bg-gray-50 text-sm text-gray-600">
                  Seu carrinho está vazio.
                </div>
              ) : (
                cart.map((it) => {
                  let max: number | undefined;
                  let atMax = false;

                  if (it.kind === "variant") {
                    max = it.max;
                    atMax = typeof max === "number" && it.qty >= max;
                  } else {
                    max = it.max;
                    atMax = typeof max === "number" && it.qty >= max;
                  }

                  return (
                    <div
                      key={it.id}
                      className="flex items-center gap-3 p-2 rounded-xl border border-gray-100 bg-white shadow-sm"
                    >
                      <div className="w-16 h-16 rounded-lg bg-gray-100 overflow-hidden border border-gray-100 flex items-center justify-center">
                        {it.imageUrl ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={it.imageUrl} alt={it.title} className="w-full h-full object-cover" />
                        ) : (
                          <div className="w-8 h-8 rounded bg-gray-200" />
                        )}
                      </div>

                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-medium truncate">{it.title}</div>
                        <div className="text-xs text-gray-500">
                          {formatPrice(it.price_cents)}
                          {it.kind === "variant" ? (
                            <>
                              {" "}&bull; Tam: <b>{it.size}</b>
                              {it.color_label ? (
                                <>
                                  {" "}&bull; Cor: <b>{it.color_label}</b>
                                </>
                              ) : null}
                            </>
                          ) : null}
                        </div>

                        <div className="mt-1 inline-flex items-center gap-2">
                          <button
                            onClick={() =>
                              setCart((c) =>
                                c.flatMap((x) =>
                                  x.id === it.id
                                    ? x.qty - 1 <= 0
                                      ? []
                                      : [{ ...x, qty: x.qty - 1 } as CartItem]
                                    : [x]
                                )
                              )
                            }
                            className="w-7 h-7 rounded-lg border border-gray-200 grid place-items-center"
                          >
                            -
                          </button>

                          <span className="text-sm w-6 text-center">{it.qty}</span>

                          <button
                            onClick={() =>
                              setCart((c) =>
                                c.map((x) => {
                                  if (x.id !== it.id) return x;
                                  if (typeof max === "number") {
                                    return { ...x, qty: Math.min(x.qty + 1, max) } as CartItem;
                                  }
                                  return { ...x, qty: x.qty + 1 } as CartItem;
                                })
                              )
                            }
                            className="w-7 h-7 rounded-lg border border-gray-200 grid place-items-center disabled:opacity-50"
                            disabled={atMax}
                            title={atMax ? "Limite de estoque" : undefined}
                          >
                            +
                          </button>

                          <button
                            onClick={() => setCart((c) => c.filter((x) => x.id !== it.id))}
                            className="ml-2 text-xs underline text-gray-600"
                          >
                            remover
                          </button>
                        </div>

                        {typeof max === "number" && (
                          <div className="text-[11px] text-gray-500 mt-1">Estoque disponível: {max}</div>
                        )}
                      </div>

                      <div className="text-sm font-semibold">
                        {formatPrice(it.price_cents * it.qty)}
                      </div>
                    </div>
                  );
                })
              )}
            </div>

            <footer className="p-3 border-t border-gray-100 space-y-2">
              <div className="flex items-center justify-between text-sm">
                <span>Total</span>
                <span className="font-semibold">{formatPrice(cartTotal)}</span>
              </div>
              <div className="flex items-center gap-2">
                <button onClick={() => setCart([])} className="flex-1 px-3 py-2 rounded-xl border border-gray-200">
                  Limpar
                </button>
                <button
                  onClick={handleCheckout}
                  className="flex-1 px-3 py-2 rounded-xl text-white disabled:opacity-50 inline-flex items-center justify-center gap-2"
                  style={{ backgroundColor: ACCENT }}
                  disabled={cart.length === 0 || submitting}
                >
                  {submitting ? (
                    <>
                      <span className="h-4 w-4 border-2 border-white/70 border-t-transparent rounded-full animate-spin" />
                      Finalizando...
                    </>
                  ) : (
                    "Finalizar"
                  )}
                </button>
              </div>
            </footer>
          </aside>
        </div>
      )}

      {/* Quick Add Modal */}
      {quickAddOpen && quickAdd && (
        <div className="fixed inset-0 z-[70]">
          <button className="absolute inset-0 bg-black/35" onClick={() => setQuickAddOpen(false)} />

          <div className="absolute inset-x-0 bottom-0 mx-auto max-w-screen-sm bg-white rounded-t-2xl border border-gray-100 p-3 shadow-xl">
            <div className="flex gap-3">
              <div className="w-24 h-24 rounded-xl bg-gray-100 border border-gray-200 overflow-hidden flex-shrink-0">
                {quickAdd.imageUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={quickAdd.imageUrl} alt={quickAdd.title} className="w-full h-full object-cover" />
                ) : null}
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-sm font-semibold truncate">{quickAdd.title}</div>
                <div className="text-sm text-gray-800">{formatPrice(quickAdd.price_cents)}</div>
              </div>
            </div>

            {/* Tamanho (se houver) */}
            {quickAdd.mode !== "simple" && quickAdd.sizes.length > 0 && (
              <div className="mt-3">
                <div className="text-sm font-medium mb-1">Tamanho</div>
                <div className="flex flex-wrap gap-2">
                  {SIZE_LABELS.map((sz) => {
                    const entry = quickAdd.sizes.find((e) => e.key === sz);
                    const exists = Boolean(entry);
                    const active = qaSelectedSize === sz;
                    const disabled = !exists || (entry ? entry.amount <= 0 : true);

                    return (
                      <button
                        key={sz}
                        type="button"
                        disabled={disabled}
                        onClick={() => handleSelectSize(sz)}
                        className={`px-3 py-1.5 rounded-full border text-sm ${
                          active ? "text-white border-transparent" : "text-gray-700 border-gray-200 bg-gray-50"
                        } disabled:opacity-40 disabled:cursor-not-allowed`}
                        style={active ? { backgroundColor: ACCENT } : {}}
                        title={
                          !exists ? "Indisponível"
                          : entry && entry.amount > 0 ? `Disponível: ${entry.amount} un.`
                          : "Esgotado"
                        }
                      >
                        {sz}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Cor (apenas no modo size-color) */}
            {quickAdd.mode === "size-color" && quickAdd.colors.length > 0 && (
              <div className="mt-3">
                <div className="text-sm font-medium mb-1">Cor</div>

                {(() => {
                  // se houver 3 ou mais cores, NÃO mostrar os nomes (só as bolinhas)
                  const showColorNames = quickAdd.colors.length <= 3;

                  return (
                    <div className="flex flex-wrap gap-2">
                      {quickAdd.colors.map((c) => {
                        const active = qaSelectedColor === c.id;

                        // desabilita enquanto não há tamanho
                        let disabled = !qaSelectedSize;

                        // se já há tamanho, desabilita quando a combinação não tem estoque
                        if (!disabled && qaSelectedSize && quickAdd.sizeIdByKey) {
                          const sizeId = quickAdd.sizeIdByKey[qaSelectedSize];
                          if (sizeId) {
                            disabled = comboQty(sizeId, c.id) <= 0;
                          }
                        }

                        return (
                          <button
                            key={c.id}
                            type="button"
                            disabled={disabled}
                            onClick={() => handleSelectColor(c.id)}
                            aria-label={c.name}
                            title={c.name}
                            className={`px-2.5 py-1.5 rounded-full border text-sm flex items-center
                  ${showColorNames ? "gap-2" : "gap-0"}
                  ${active ? "text-white border-transparent" : "text-gray-700 border-gray-200 bg-gray-50"}
                  disabled:opacity-40 disabled:cursor-not-allowed`}
                            style={active ? { backgroundColor: ACCENT } : {}}
                          >
                            <span
                              className="inline-block w-4 h-4 rounded-full border"
                              style={{ backgroundColor: c.hex ?? "#fff", borderColor: "#e5e7eb" }}
                            />
                            {showColorNames && <span className="whitespace-nowrap">{c.name}</span>}
                          </button>
                        );
                      })}
                    </div>
                  );
                })()}
              </div>
            )}

            {/* Quantidade + CTA */}
            <div className="mt-3 flex items-center justify-between">
              <div className="inline-flex items-center gap-2 border border-gray-200 rounded-xl p-1">
                <button onClick={() => setQaQty((q) => Math.max(1, q - 1))} className="w-8 h-8 grid place-items-center">-</button>
                <span className="w-8 text-center select-none">{qaQty}</span>
                <button
                  onClick={() => {
                    if (quickAdd.mode === "size-only" || quickAdd.mode === "size-color") {
                      if (!qaSelectedSize) return;
                      const entry = quickAdd.sizes.find((s) => s.key === qaSelectedSize);
                      const max = entry?.amount ?? 1;
                      setQaQty((q) => Math.min(max, q + 1));
                    } else {
                      const prod = products.find((x) => x.id === quickAdd.productId);
                      const max = prod?.baseKnown ? prod.baseAmount : 1;
                      setQaQty((q) => Math.min(max, q + 1));
                    }
                  }}
                  className="w-8 h-8 grid place-items-center"
                >
                  +
                </button>
              </div>

              <button
                onClick={confirmQuickAdd}
                className="px-4 py-2 rounded-xl text-white"
                style={{ backgroundColor: ACCENT }}
                disabled={
                  quickAdd.mode === "size-only" ? !qaSelectedSize
                  : quickAdd.mode === "size-color" ? (!qaSelectedSize || !qaSelectedColor)
                  : false
                }
              >
                Adicionar ao carrinho
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}

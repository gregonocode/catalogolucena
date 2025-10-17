// src/app/detalhes_produtos/[id]/page.tsx
"use client";

import React from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import {
  ArrowLeft,
  ShoppingCart,
  Loader2,
  ChevronDown,
  ChevronUp,
  AlertTriangle,
} from "lucide-react";
import { supabaseBrowser } from "@/lib/supabase-browser";

const ACCENT = "#01A920";

/* ===================== Tipos (iguais ao front) ===================== */
type SizeKey = "P" | "M" | "G" | "GG";
const SIZE_LABELS: SizeKey[] = ["P", "M", "G", "GG"];

type Product = {
  id: string;
  title: string;
  description: string | null;
  price_cents: number;
  active: boolean;
  amount: number | null; // pode ser null => desconhecido
};

type ImageRow = { storage_path: string; is_primary: boolean | null };

type SizeEntry = { key: SizeKey; optionId: string; amount: number };
type ColorEntry = { id: string; name: string; hex: string | null };

type PVSetLink = { variant_option_id: string };
type PVSetRow = {
  id: string;
  amount: number | null;
  product_variant_set_options: PVSetLink[];
};

/** Mapa de estoque por combinação: `${sizeId}::${colorId}` -> amount */
type StockMap = Record<string, number>;

/* ==== Carrinho (LocalStorage) ==== */
type CartItem = {
  id: string; // `${product_id}:${sizeOptId || "-"}:${colorOptId || "-"}`
  product_id: string;
  title: string;
  price_cents: number;
  imageUrl: string | null;
  qty: number;
  max?: number;
  size_label?: SizeKey | null;
  color_label?: string | null;
  color_hex?: string | null;
  size_option_id?: string | null;
  color_option_id?: string | null;
};

const CART_KEY = "cart_v3_variants";

/* ===================== Utils ===================== */
function formatPrice(cents: number) {
  return (cents / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}
function readCartLS(): CartItem[] {
  try {
    const raw = localStorage.getItem(CART_KEY);
    return raw ? (JSON.parse(raw) as CartItem[]) : [];
  } catch {
    return [];
  }
}
function writeCartLS(items: CartItem[]) {
  try {
    localStorage.setItem(CART_KEY, JSON.stringify(items));
  } catch {}
}
function countCartLS(): number {
  return readCartLS().reduce((sum, it) => sum + it.qty, 0);
}
const norm = (s: string) => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();

/* ===================== Página ===================== */
export default function ProductDetailsPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const supabase = supabaseBrowser();

  // UI
  const [loading, setLoading] = React.useState(true);
  const [err, setErr] = React.useState<string | null>(null);

  // Produto/imagens
  const [product, setProduct] = React.useState<Product | null>(null);
  const [images, setImages] = React.useState<string[]>([]);
  const [activeImg, setActiveImg] = React.useState(0);

  // Variantes (mesma estrutura do modal)
  const [sizes, setSizes] = React.useState<SizeEntry[]>([]);
  const [colors, setColors] = React.useState<ColorEntry[]>([]);
  const [stockByCombo, setStockByCombo] = React.useState<StockMap>({});

  // Conhecimento do estoque
  const [variantsKnown, setVariantsKnown] = React.useState(false);
  const [baseKnown, setBaseKnown] = React.useState(false);
  const [baseAmount, setBaseAmount] = React.useState(0);

  // Seleção/quantidade (tamanho → cor)
  const [selectedSize, setSelectedSize] = React.useState<SizeKey | null>(null);
  const [selectedSizeId, setSelectedSizeId] = React.useState<string | null>(null);
  const [selectedColorId, setSelectedColorId] = React.useState<string | null>(null);

  const [qty, setQty] = React.useState(1);
  const [adding, setAdding] = React.useState(false);

  // Badge do carrinho
  const [cartCount, setCartCount] = React.useState(0);
  React.useEffect(() => {
    setCartCount(countCartLS());
    const onStorage = (e: StorageEvent) => {
      if (e.key === CART_KEY) setCartCount(countCartLS());
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  // ==== FUNÇÕES iguais às do modal ====
  function comboQty(sizeId: string | null, colorId: string | null): number {
    const sizesLocal = sizes || [];
    const map = stockByCombo || {};
    const hasGrid = Object.keys(map).length > 0;

    if (!hasGrid) {
      // Sem grade: usa amount por tamanho se houver
      if (sizeId) {
        const entry = sizesLocal.find((s) => s.optionId === sizeId);
        return entry?.amount ?? 0;
      }
      // produto simples ou só cor → desconhecido (0)
      return 0;
    }

    if (sizeId && colorId) {
      const k = `${sizeId}::${colorId}`;
      const v = map[k];
      return typeof v === "number" ? Math.max(0, v) : 0;
    }

    if (!sizeId && colorId) {
      // soma coluna (todas as linhas para a cor)
      let sum = 0;
      for (const [k, v] of Object.entries(map)) {
        if (k.endsWith(`::${colorId}`)) sum += v;
      }
      return Math.max(0, sum);
    }

    if (sizeId && !colorId) {
      // soma linha (todas as cores do tamanho)
      let sum = 0;
      for (const [k, v] of Object.entries(map)) {
        if (k.startsWith(`${sizeId}::`)) sum += v;
      }
      return Math.max(0, sum);
    }

    // nada selecionado: soma total
    return Object.values(map).reduce((s, n) => s + n, 0);
  }

  function handleSelectSize(sz: SizeKey) {
    const found = sizes.find((s) => s.key === sz) || null;
    const newSizeId = found?.optionId ?? null;

    // Lista de cores válidas para o novo tamanho (quando temos grade)
    let nextColorId = selectedColorId;
    if (newSizeId) {
      const validColors = Object.keys(stockByCombo).length
        ? colors.filter((c) => comboQty(newSizeId, c.id) > 0)
        : colors;

      // Se já tinha cor selecionada mas a combinação ficou inválida, limpamos
      if (nextColorId && comboQty(newSizeId, nextColorId) <= 0) {
        nextColorId = validColors.length === 1 ? validColors[0].id : null;
      }

      // Se não havia cor selecionada, e só existe 1 válida, auto-seleciona
      if (!nextColorId && validColors.length === 1) {
        nextColorId = validColors[0].id;
      }
    }

    setSelectedSize(sz);
    setSelectedSizeId(newSizeId);
    setSelectedColorId(nextColorId ?? null);
    setQty(1);
  }

  function handleSelectColor(colorId: string) {
    // Só permite cor depois de tamanho (quando há tamanhos)
    if (sizes.length && !selectedSizeId) return;
    // Se temos grade e a combinação é zero, não seleciona
    if (selectedSizeId && Object.keys(stockByCombo).length) {
      if (comboQty(selectedSizeId, colorId) <= 0) return;
    }
    setSelectedColorId(colorId);
    setQty(1);
  }

  // ===== Carrega produto + imagens + variantes/estoque (espelhando o modal) =====
  React.useEffect(() => {
    let ignore = false;
    (async () => {
      if (!id) return;
      setLoading(true);
      setErr(null);
      try {
        // Produto
        const { data: prow, error: perr } = await supabase
          .from("products")
          .select("id, title, description, price_cents, active, amount")
          .eq("id", id)
          .maybeSingle<Product>();
        if (perr) throw perr;
        if (!prow) throw new Error("Produto não encontrado");

        // Imagens
        const { data: irows, error: ierr } = await supabase
          .from("product_images")
          .select("storage_path, is_primary")
          .eq("product_id", id)
          .order("is_primary", { ascending: false })
          .order("created_at", { ascending: false });
        if (ierr) throw ierr;
        const urls: string[] =
          (irows as ImageRow[] | null)?.map((r) => {
            const { data } = supabase.storage.from("produtos").getPublicUrl(r.storage_path);
            return data.publicUrl;
          }) ?? [];

        // Grupos de variantes
        const { data: gRows, error: gErr } = await supabase
          .from("variant_groups")
          .select("id, name")
          .eq("product_id", id);
        if (gErr) throw gErr;

        const sizeGroup = (gRows ?? []).find((g) => norm(g.name) === "tamanho") ?? null;
        const colorGroup = (gRows ?? []).find((g) => norm(g.name) === "cor") ?? null;

        // Opções
        type VOSize = { id: string; value: string };
        type VOColor = { id: string; value: string; code: string | null };

        let sizeOpts: VOSize[] = [];
        if (sizeGroup) {
          const { data, error } = await supabase
            .from("variant_options")
            .select("id, value")
            .eq("variant_group_id", sizeGroup.id)
            .in("value", SIZE_LABELS as string[]);
          if (error) throw error;
          sizeOpts = (data ?? []) as VOSize[];
        }

        let colorOpts: VOColor[] = [];
        if (colorGroup) {
          const { data, error } = await supabase
            .from("variant_options")
            .select("id, value, code, position")
            .eq("variant_group_id", colorGroup.id)
            .order("position", { ascending: true });
          if (error) throw error;
          colorOpts = (data ?? []) as VOColor[];
        }

        // Grade (product_variant_sets)
        let sizesFromSets: SizeEntry[] = [];
        const map: StockMap = {};
        let knownVariants = false;

        if (sizeGroup && colorGroup) {
          const sizeIds = sizeOpts.map((o) => o.id);
          const colorIds = new Set(colorOpts.map((c) => c.id));

          const { data: sets } = await supabase
            .from("product_variant_sets")
            .select("id, amount, product_variant_set_options(variant_option_id)")
            .eq("product_id", id);

          const sumBySize = new Map<string, number>();
          const setsTyped: PVSetRow[] = (sets ?? []) as PVSetRow[];

          setsTyped.forEach((s) => {
            const optIds = (s.product_variant_set_options ?? []).map((o) => o.variant_option_id);
            const sizeId = optIds.find((x) => sizeIds.includes(x));
            const colorId = optIds.find((x) => colorIds.has(x));

            const amount = Number(s.amount ?? 0);

            if (sizeId) {
              sumBySize.set(sizeId, (sumBySize.get(sizeId) ?? 0) + amount);
            }
            if (sizeId && colorId) {
              const k = `${sizeId}::${colorId}`;
              map[k] = (map[k] ?? 0) + amount;
            }
          });

          sizesFromSets = sizeOpts
            .map((o) => ({
              key: o.value as SizeKey,
              optionId: o.id,
              amount: sumBySize.get(o.id) ?? 0,
            }))
            .sort((a, b) => SIZE_LABELS.indexOf(a.key) - SIZE_LABELS.indexOf(b.key));

          if (setsTyped.length > 0) knownVariants = true;
        }

        // Fallback: apenas tamanho (product_variants)
        if (sizeGroup && !colorGroup) {
          const sizeIds = sizeOpts.map((o) => o.id);
          type PV = { variant_option_id: string; amount: number | null };
          let pvRows: PV[] = [];
          if (sizeIds.length) {
            const { data } = await supabase
              .from("product_variants")
              .select("variant_option_id, amount")
              .eq("product_id", id)
              .in("variant_option_id", sizeIds);
            pvRows = (data ?? []) as PV[];
          }
          sizesFromSets = sizeOpts
            .map((o) => {
              const key = o.value as SizeKey;
              const amt = Number(pvRows.find((r) => r.variant_option_id === o.id)?.amount ?? 0);
              return { key, optionId: o.id, amount: amt };
            })
            .sort((a, b) => SIZE_LABELS.indexOf(a.key) - SIZE_LABELS.indexOf(b.key));

          if (pvRows.length > 0) knownVariants = true;
        }

        // Monta arrays finais
        const colorEntries: ColorEntry[] = (colorOpts ?? []).map((c) => ({
          id: c.id,
          name: c.value,
          hex: c.code ?? null,
        }));

        // Base amount (produto simples)
        const baseIsKnown = prow.amount !== null && prow.amount !== undefined;
        const baseAmt = baseIsKnown ? Number(prow.amount) : 0;

        if (!ignore) {
          setProduct(prow);
          setImages(urls);
          setActiveImg(0);

          setSizes(sizesFromSets);
          setColors(colorEntries);
          setStockByCombo(map);

          setVariantsKnown(knownVariants);
          setBaseKnown(baseIsKnown);
          setBaseAmount(baseAmt);

          // Pré-seleções: tamanho único com estoque (>0) → já seleciona
          if (sizesFromSets.length && knownVariants) {
            const withStock = sizesFromSets.filter((e) => e.amount > 0);
            if (withStock.length === 1) {
              setSelectedSize(withStock[0].key);
              setSelectedSizeId(withStock[0].optionId);
            } else {
              setSelectedSize(null);
              setSelectedSizeId(null);
            }
          } else {
            setSelectedSize(null);
            setSelectedSizeId(null);
          }

          // Cor: manter ordem tamanho→cor (não pré-selecionar)
          setSelectedColorId(null);
          setQty(1);
        }
      } catch (e) {
        const msg = e instanceof Error ? e.message : "Falha ao carregar produto";
        console.error(e);
        if (!ignore) setErr(msg);
      } finally {
        if (!ignore) setLoading(false);
      }
    })();
    return () => {
      ignore = true;
    };
  }, [id, supabase]);

  // Estado derivado
  const hasSizes = sizes.length > 0;
  const hasColors = colors.length > 0;

  // estoque total “conhecido?”
  const stockKnown =
    hasSizes || hasColors ? variantsKnown || Object.keys(stockByCombo).length > 0 : baseKnown;

  // Helpers quantidade
  function currentMax(): number {
    if (hasSizes || hasColors) {
      if (Object.keys(stockByCombo).length) {
        const sid = selectedSizeId ?? null;
        const cid = selectedColorId ?? null;
        return comboQty(sid, cid);
      }
      if (hasSizes && selectedSize) {
        const entry = sizes.find((s) => s.key === selectedSize);
        return entry?.amount ?? 0;
      }
      return 0; // desconhecido
    }
    return baseAmount;
  }

  const totalAmount = (() => {
    if (Object.keys(stockByCombo).length) {
      return Object.values(stockByCombo).reduce((s, n) => s + n, 0);
    }
    if (hasSizes) return sizes.reduce((s, e) => s + e.amount, 0);
    return baseAmount;
  })();

  // IMPORTANTE: quando estoque é DESCONHECIDO, não marcamos como esgotado
  const isOut = stockKnown ? totalAmount <= 0 : false;
  const isLow = stockKnown && !isOut && totalAmount < 10;

  function handleDec() {
    setQty((q) => Math.max(1, q - 1));
  }
  function handleInc() {
    const max = Math.max(1, currentMax());
    setQty((q) => Math.min(max, q + 1));
  }

  function swatchBg(hex: string | null): string {
    return /^#([0-9A-Fa-f]{6})$/.test(hex ?? "") ? (hex as string) : "#e5e7eb";
  }

  // Adicionar ao carrinho (igual filosofia do modal: checkout valida de novo)
  function handleAddToCart() {
    if (!product) return;
    if (!product.active) return;
    if (isOut) return;

    if (hasSizes && !selectedSizeId) {
      alert("Selecione um tamanho.");
      return;
    }
    if (hasColors && !selectedColorId) {
      alert("Selecione uma cor.");
      return;
    }

    const max = currentMax();
    if (stockKnown && max <= 0) {
      alert("Sem estoque para a combinação escolhida.");
      return;
    }

    const imageUrl = images[0] || null;
    const sizeId = selectedSizeId ?? "-";
    const colorId = selectedColorId ?? "-";
    const itemId = `${product.id}:${sizeId}:${colorId}`;

    const colorMeta =
      hasColors && selectedColorId
        ? colors.find((c) => c.id === selectedColorId) || null
        : null;
    const sizeLabel = hasSizes ? selectedSize : null;

    const currentCart = readCartLS();
    const idx = currentCart.findIndex((x) => x.id === itemId);

    const baseItem: Omit<CartItem, "id" | "qty"> = {
      product_id: product.id,
      title: product.title,
      price_cents: product.price_cents,
      imageUrl,
      max: stockKnown ? max : undefined,
      size_label: sizeLabel ?? null,
      color_label: colorMeta?.name ?? null,
      color_hex: colorMeta?.hex ?? null,
      size_option_id: selectedSizeId ?? null,
      color_option_id: selectedColorId ?? null,
    };

    setAdding(true);
    try {
      if (idx >= 0) {
        const cur = currentCart[idx];
        const nextQty = stockKnown ? Math.min(cur.qty + qty, max) : cur.qty + qty;
        currentCart[idx] = { ...cur, qty: nextQty, max: stockKnown ? max : cur.max };
      } else {
        currentCart.push({
          id: itemId,
          qty: stockKnown ? Math.min(qty, max) : qty,
          ...baseItem,
        });
      }
      writeCartLS(currentCart);
      setCartCount(countCartLS());
    } finally {
      setAdding(false);
    }
  }

  return (
    <main className="min-h-dvh bg-white text-gray-900">
      <header className="sticky top-0 z-40 bg-white border-b border-gray-100">
        <div className="mx-auto max-w-screen-sm px-3 py-3 flex items-center gap-2">
          <button
            onClick={() => router.back()}
            className="p-2 -ml-1 rounded-xl border border-gray-200 bg-white shadow-sm active:scale-[0.98]"
            aria-label="Voltar"
          >
            <ArrowLeft className="w-5 h-5" />
          </button>
          <div className="flex-1 text-center font-semibold">Detalhes do produto</div>
          <Link
            href="/"
            className="relative p-2 rounded-xl border border-gray-200 bg-white shadow-sm active:scale-[0.98]"
            aria-label="Ir ao início"
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
          </Link>
        </div>
      </header>

      <section className="mx-auto max-w-screen-sm px-3 py-4">
        {loading ? (
          <div className="p-3 rounded-xl border border-gray-100 bg-gray-50 text-sm text-gray-600 flex items-center gap-2">
            <Loader2 className="w-4 h-4 animate-spin" /> Carregando...
          </div>
        ) : err ? (
          <div className="p-3 rounded-xl border border-red-200 bg-red-50 text-sm text-red-700">{err}</div>
        ) : !product ? (
          <div className="p-3 rounded-xl border border-gray-100 bg-gray-50 text-sm text-gray-600">
            Produto não encontrado.
          </div>
        ) : (
          <div className="space-y-4">
            {/* Galeria */}
            <div className="rounded-2xl border border-gray-100 overflow-hidden">
              <div className="bg-gray-100 aspect-[3/4] w-full flex items-center justify-center overflow-hidden">
                {images[activeImg] ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={images[activeImg]}
                    alt={product.title}
                    className="w-full h-full object-cover"
                  />
                ) : (
                  <div className="w-16 h-16 rounded-lg bg-gray-200" />
                )}
              </div>
              {images.length > 1 && (
                <div className="flex gap-2 p-2 overflow-x-auto">
                  {images.map((src, i) => (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      key={i}
                      src={src}
                      alt={`Imagem ${i + 1}`}
                      onClick={() => setActiveImg(i)}
                      className={`h-16 w-12 object-cover rounded-lg border ${
                        i === activeImg ? "border-gray-900" : "border-gray-200"
                      } cursor-pointer`}
                    />
                  ))}
                </div>
              )}
            </div>

            {/* Título & preço */}
            <div className="flex items-start justify-between gap-3">
              <h1 className="text-base font-semibold leading-tight flex-1">
                {product.title}
              </h1>
              <div className="text-base font-semibold whitespace-nowrap">
                {formatPrice(product.price_cents)}
              </div>
            </div>

            {/* Estoque info */}
            {isOut ? (
              <div className="inline-flex items-center gap-2 px-2 py-1 rounded-full text-xs text-red-700 bg-red-50 border border-red-200">
                ESGOTADO
              </div>
            ) : isLow ? (
              <div className="inline-flex items-center gap-2 px-2 py-1 rounded-full text-xs text-orange-700 bg-orange-50 border border-orange-200">
                <AlertTriangle className="w-3 h-3" />
                Restam {totalAmount} un.
              </div>
            ) : null}

            {/* Descrição colapsável */}
            <DetailsAccordion title="Descrição">
              {product.description ? (
                <p className="text-sm text-gray-700 whitespace-pre-wrap">
                  {product.description}
                </p>
              ) : (
                <p className="text-sm text-gray-500">Sem descrição.</p>
              )}
            </DetailsAccordion>

            {/* Variantes: Tamanho — sempre clicável se houver ALGUMA cor para aquele tamanho */}
            {sizes.length > 0 && (
              <div>
                <div className="text-sm font-medium capitalize mb-1">Tamanho</div>
                <div className="flex flex-wrap gap-2">
                  {SIZE_LABELS.map((sz) => {
                    const entry = sizes.find((e) => e.key === sz);
                    const exists = Boolean(entry);
                    const active = selectedSize === sz;

                    const hasGrid = Object.keys(stockByCombo).length > 0;
                    let rowAvailable = entry ? entry.amount : 0;

                    // se há grade, botão de tamanho considera a soma da linha
                    if (hasGrid && entry) {
                      let sum = 0;
                      for (const [k, v] of Object.entries(stockByCombo)) {
                        if (k.startsWith(`${entry.optionId}::`)) sum += v;
                      }
                      rowAvailable = sum;
                    }

                    const disabled = !exists || rowAvailable <= 0;

                    const title = !exists
                      ? "Tamanho não disponível"
                      : hasGrid
                      ? (rowAvailable > 0 ? `Disponível: ${rowAvailable} un. (todas as cores)` : "Esgotado")
                      : (rowAvailable > 0 ? `Disponível: ${rowAvailable} un.` : "Esgotado");

                    return (
                      <button
                        key={sz}
                        type="button"
                        onClick={() => handleSelectSize(sz)}
                        disabled={disabled}
                        className={`px-3 py-1.5 rounded-full border text-sm ${
                          active
                            ? "text-white border-transparent"
                            : "text-gray-700 border-gray-200 bg-gray-50"
                        } disabled:opacity-40 disabled:cursor-not-allowed`}
                        style={active ? { backgroundColor: ACCENT } : {}}
                        title={title}
                      >
                        {sz}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Variantes: Cor — exige tamanho primeiro; nomes quando <= 3 cores */}
            {colors.length > 0 && (
              <div>
                <div className="text-sm font-medium capitalize mb-1">Cor</div>
                {(() => {
                  const showColorNames = colors.length <= 3;
                  return (
                    <div className="flex flex-wrap gap-2">
                      {colors.map((c) => {
                        const mustPickSizeFirst = sizes.length > 0 && !selectedSizeId;

                        // disponibilidade via grade quando houver e já tiver tamanho
                        let available = 0;
                        const hasGrid = Object.keys(stockByCombo).length > 0;
                        if (hasGrid) {
                          if (selectedSizeId) {
                            available = comboQty(selectedSizeId, c.id);
                          } else {
                            available = 0;
                          }
                        } else {
                          // sem grade, não bloqueamos por desconhecido
                          available = 1;
                        }

                        const selected = selectedColorId === c.id;
                        const disabled = mustPickSizeFirst || (hasGrid ? available <= 0 : false);
                        const title = mustPickSizeFirst
                          ? "Selecione um tamanho primeiro"
                          : hasGrid
                          ? (available > 0 ? `${c.name} — ${available} un.` : `${c.name} — Esgotado`)
                          : "Selecione um tamanho para ver disponibilidade";

                        return (
                          <button
                            key={c.id}
                            type="button"
                            disabled={disabled}
                            onClick={() => handleSelectColor(c.id)}
                            aria-label={c.name}
                            title={title}
                            className={`px-2.5 py-1.5 rounded-full border text-sm flex items-center ${
                              showColorNames ? "gap-2" : "gap-0"
                            } ${
                              selected ? "text-white border-transparent" : "text-gray-700 border-gray-200 bg-gray-50"
                            } disabled:opacity-40 disabled:cursor-not-allowed`}
                            style={selected ? { backgroundColor: ACCENT } : {}}
                          >
                            <span
                              className="inline-block w-4 h-4 rounded-full border"
                              style={{ backgroundColor: swatchBg(c.hex), borderColor: "#e5e7eb" }}
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

            {/* Quantidade e CTA */}
            <div className="flex items-center gap-3">
              <div className="inline-flex items-center gap-2 border border-gray-200 rounded-xl p-1">
                <button onClick={handleDec} className="w-8 h-8 grid place-items-center" disabled={isOut}>
                  -
                </button>
                <span className="w-8 text-center select-none">{qty}</span>
                <button
                  onClick={handleInc}
                  className="w-8 h-8 grid place-items-center"
                  disabled={isOut || qty >= Math.max(1, currentMax())}
                >
                  +
                </button>
              </div>
              <button
                onClick={handleAddToCart}
                disabled={
                  !product.active ||
                  adding ||
                  isOut ||
                  (sizes.length > 0 && !selectedSizeId) ||
                  (colors.length > 0 && !selectedColorId)
                }
                className="flex-1 px-3 py-3 rounded-xl text-white disabled:opacity-50"
                style={{ backgroundColor: ACCENT }}
              >
                {adding ? <Loader2 className="w-4 h-4 animate-spin inline mr-2" /> : null}
                {isOut ? "Esgotado" : "Adicionar ao carrinho"}
              </button>
            </div>

            {!product.active && (
              <div className="p-3 rounded-xl border border-yellow-200 bg-yellow-50 text-sm text-yellow-800">
                Produto inativo no momento.
              </div>
            )}

            <div className="text-center pt-2">
              <Link href="/" className="text-sm underline text-gray-600">
                Voltar para a loja
              </Link>
            </div>
          </div>
        )}
      </section>
    </main>
  );
}

/* ===================== Accordion ===================== */
function DetailsAccordion({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  const [open, setOpen] = React.useState(true);
  return (
    <div className="rounded-2xl border border-gray-100">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center justify-between px-3 py-2"
      >
        <span className="text-sm font-medium">{title}</span>
        {open ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
      </button>
      {open && <div className="px-3 pb-3 text-sm text-gray-700">{children}</div>}
    </div>
  );
}

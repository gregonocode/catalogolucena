"use client";

import React from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { ArrowLeft, ShoppingCart, Loader2, ChevronDown, ChevronUp, AlertTriangle } from "lucide-react";
import { supabaseBrowser } from "@/lib/supabase-browser";

const ACCENT = "#01A920";

/* ===================== Tipos ===================== */
type Product = {
  id: string;
  title: string;
  description: string | null;
  price_cents: number;
  active: boolean;
  amount: number | null; // pode vir null se RLS bloquear ou sem controle de estoque base
};

type ImageRow = { storage_path: string; is_primary: boolean | null };

type SizeKey = "P" | "M" | "G" | "GG";
const SIZE_LABELS: SizeKey[] = ["P", "M", "G", "GG"];

type SizeEntry = { key: SizeKey; optionId: string; amount: number };

/** Carrinho:
 * - COM VARIANTE (tamanho): inclui variant_option_id/size
 * - SEM VARIANTE: não inclui esses campos
 */
type CartItemWithVariant = {
  id: string; // `${product_id}:${variant_option_id}`
  product_id: string;
  variant_option_id: string;
  size: SizeKey;
  title: string;
  price_cents: number;
  imageUrl: string | null;
  qty: number;
  max?: number; // estoque da variante
};
type CartItemNoVariant = {
  id: string; // `${product_id}`
  product_id: string;
  title: string;
  price_cents: number;
  imageUrl: string | null;
  qty: number;
  max?: number; // estoque do produto (sem variação)
};
type CartItem = CartItemWithVariant | CartItemNoVariant;

/* ===================== Utils (LS) ===================== */
const CART_KEY = "cart_v2_sizes";

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
  } catch {
    /* noop */
  }
}
function countCartLS(): number {
  const items = readCartLS();
  return items.reduce((sum, it) => sum + it.qty, 0);
}

// Insere/atualiza item somando quantidades, respeitando limite (max se fornecido)
type CartItemWithoutQty =
  | Omit<CartItemWithVariant, "qty">
  | Omit<CartItemNoVariant, "qty">;

function upsertCartLS(item: CartItemWithoutQty, addQty: number, clampMax?: number): CartItem[] {
  const cart = readCartLS();
  const idx = cart.findIndex((x) => x.id === item.id);

  const limit = typeof clampMax === "number" ? clampMax : undefined;

  if (idx >= 0) {
    const cur = cart[idx];
    const nextQty = limit ? Math.min(cur.qty + addQty, limit) : cur.qty + addQty;
    const next: CartItem = { ...cur, qty: Math.max(1, nextQty), max: limit };
    const updated = [...cart];
    updated[idx] = next;
    return updated;
  }

  const firstQty = Math.max(1, limit ? Math.min(addQty, limit) : addQty);
  return [...cart, { ...item, qty: firstQty, max: limit } as CartItem];
}

/* ===================== Página ===================== */
export default function ProductDetailsPage() {
  const params = useParams<{ id: string }>();
  const id = params.id;
  const router = useRouter();
  const supabase = supabaseBrowser();

  const [loading, setLoading] = React.useState(true);
  const [err, setErr] = React.useState<string | null>(null);

  const [product, setProduct] = React.useState<Product | null>(null);
  const [images, setImages] = React.useState<string[]>([]);
  const [activeImg, setActiveImg] = React.useState(0);

  // Tamanhos (grupo "Tamanho") e estoque por variante
  const [sizes, setSizes] = React.useState<SizeEntry[]>([]);
  const [selectedSize, setSelectedSize] = React.useState<SizeKey | null>(null);
  const [variantStockKnown, setVariantStockKnown] = React.useState(false); // se conseguimos ler product_variants

  // Quantidade e estado de adicionar
  const [qty, setQty] = React.useState(1);
  const [adding, setAdding] = React.useState(false);

  // Badge do carrinho
  const [cartCount, setCartCount] = React.useState(0);
  React.useEffect(() => {
    setCartCount(countCartLS());
    function onStorage(e: StorageEvent) {
      if (e.key === CART_KEY) setCartCount(countCartLS());
    }
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  // Carrega dados do produto (+ imagens + tamanhos/estoque)
  React.useEffect(() => {
    let ignore = false;
    (async () => {
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

        // Grupo "Tamanho"
        const { data: gData, error: gErr } = await supabase
          .from("variant_groups")
          .select("id, name")
          .eq("product_id", id)
          .eq("name", "Tamanho") // apenas o grupo de tamanhos
          .limit(1)
          .maybeSingle<{ id: string; name: string }>();
        if (gErr) throw gErr;

        let localSizes: SizeEntry[] = [];
        let localVariantStockKnown = false;

        if (gData) {
          // Opções P/M/G/GG do grupo
          const { data: opt, error: optErr } = await supabase
            .from("variant_options")
            .select("id, variant_group_id, value")
            .eq("variant_group_id", gData.id)
            .in("value", SIZE_LABELS);
          if (optErr) throw optErr;

          const options = (opt ?? []) as { id: string; variant_group_id: string; value: string }[];

          const optionIds = options.map((o) => o.id);

          // Estoque por opção em product_variants
          if (optionIds.length) {
            const { data: pv, error: pvErr } = await supabase
              .from("product_variants")
              .select("variant_option_id, amount")
              .eq("product_id", id)
              .in("variant_option_id", optionIds);
            if (pvErr) throw pvErr;

            const pvRows = (pv ?? []) as { variant_option_id: string; amount: number }[];

            // Se conseguimos ler pelo menos uma linha de variantes, consideramos “conhecido”
            localVariantStockKnown = pvRows.length > 0;

            const amountMap = new Map<string, number>(
              pvRows.map((r) => [r.variant_option_id, r.amount])
            );

            localSizes = options.map((o) => ({
              key: o.value as SizeKey,
              optionId: o.id,
              amount: amountMap.get(o.id) ?? 0,
            }));

            // Pré-seleção: se houver exatamente 1 tamanho com estoque > 0 (quando conhecido)
            if (localVariantStockKnown) {
              const withStock = localSizes.filter((s) => s.amount > 0);
              if (withStock.length === 1) {
                setSelectedSize((prev) => prev ?? withStock[0].key);
              }
            }
          }
        }

        if (!ignore) {
          setProduct(prow);
          setImages(urls);
          setActiveImg(0);
          setSizes(localSizes);
          setVariantStockKnown(localVariantStockKnown);
          // Se não pré-selecionou acima, fica null; o botão “Adicionar” força escolha quando houver tamanhos
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

  // Cálculo de estoque exibido
  const { stockKnown, hasVariants, maxStock } = React.useMemo(() => {
    const hv = sizes.length > 0;
    if (hv) {
      const selected = selectedSize ? sizes.find((s) => s.key === selectedSize) : undefined;
      const max = selected?.amount ?? 0;
      return {
        stockKnown: variantStockKnown, // só sabemos se conseguimos ler product_variants
        hasVariants: true,
        maxStock: max,
      };
    }
    // Sem variantes: o estoque é o products.amount (se vier null, é desconhecido)
    const base = product?.amount ?? 0;
    const known = product?.amount !== null && product?.amount !== undefined;
    return {
      stockKnown: known,
      hasVariants: false,
      maxStock: base,
    };
  }, [sizes, selectedSize, variantStockKnown, product?.amount]);

  const isOut = stockKnown && (maxStock ?? 0) <= 0;
  const isLow = stockKnown && !isOut && (maxStock ?? 0) < 10;

  // Quantidade (não clampa se estoque desconhecido)
  function handleDec() {
    setQty((q) => Math.max(1, q - 1));
  }
  function handleInc() {
    setQty((q) => {
      if (!stockKnown) return q + 1;
      const max = Math.max(1, maxStock || 1);
      return Math.min(q + 1, max);
    });
  }

  // Adicionar ao carrinho
  function handleAddToCart() {
    if (!product) return;
    if (!product.active) return;

    // Quando houver tamanhos, exigir seleção
    if (hasVariants) {
      if (!selectedSize) {
        alert("Selecione um tamanho antes de adicionar ao carrinho.");
        return;
      }
      const entry = sizes.find((s) => s.key === selectedSize);
      if (!entry) {
        alert("Tamanho inválido para este produto.");
        return;
      }
      // Se o estoque é conhecido e 0, bloquear; se desconhecido, permitir
      if (stockKnown && entry.amount <= 0) {
        alert("Este tamanho está esgotado no momento.");
        return;
      }

      const img = images[0] || null;
      setAdding(true);
      try {
        const clamp = stockKnown ? entry.amount : undefined; // sem clamp quando desconhecido
        const desired = Math.max(1, stockKnown ? Math.min(qty, clamp ?? 1) : qty);

        const updated = upsertCartLS(
          {
            id: `${product.id}:${entry.optionId}`,
            product_id: product.id,
            variant_option_id: entry.optionId,
            size: entry.key,
            title: product.title,
            price_cents: product.price_cents,
            imageUrl: img,
          },
          desired,
          clamp
        );
        writeCartLS(updated);
        setCartCount(countCartLS());
      } finally {
        setAdding(false);
      }
      return;
    }

    // Sem variantes
    if (stockKnown && (maxStock ?? 0) <= 0) {
      alert("Produto esgotado no momento.");
      return;
    }

    const img = images[0] || null;
    setAdding(true);
    try {
      const clamp = stockKnown ? (maxStock ?? 0) : undefined;
      const desired = Math.max(1, stockKnown ? Math.min(qty, clamp ?? 1) : qty);

      const updated = upsertCartLS(
        {
          id: product.id,
          product_id: product.id,
          title: product.title,
          price_cents: product.price_cents,
          imageUrl: img,
        },
        desired,
        clamp
      );
      writeCartLS(updated);
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
          <div className="p-3 rounded-xl border border-gray-100 bg-gray-50 text-sm text-gray-600">Produto não encontrado.</div>
        ) : (
          <div className="space-y-4">
            {/* Galeria */}
            <div className="rounded-2xl border border-gray-100 overflow-hidden">
              <div className="bg-gray-100 aspect-[3/4] w-full flex items-center justify-center overflow-hidden">
                {images[activeImg] ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={images[activeImg]} alt={product.title} className="w-full h-full object-cover" />
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
              <h1 className="text-base font-semibold leading-tight flex-1">{product.title}</h1>
              <div className="text-base font-semibold whitespace-nowrap">{formatPrice(product.price_cents)}</div>
            </div>

            {/* Estoque info (somente quando conhecido) */}
            {isOut ? (
              <div className="inline-flex items-center gap-2 px-2 py-1 rounded-full text-xs text-red-700 bg-red-50 border border-red-200">
                ESGOTADO
              </div>
            ) : isLow ? (
              <div className="inline-flex items-center gap-2 px-2 py-1 rounded-full text-xs text-orange-700 bg-orange-50 border border-orange-200">
                <AlertTriangle className="w-3 h-3" />
                Restam {maxStock} un.
              </div>
            ) : null}

            {/* Descrição colapsável */}
            <DetailsAccordion title="Descrição">
              {product.description ? (
                <p className="text-sm text-gray-700 whitespace-pre-wrap">{product.description}</p>
              ) : (
                <p className="text-sm text-gray-500">Sem descrição.</p>
              )}
            </DetailsAccordion>

            {/* Seletor de tamanho (grupo Tamanho) */}
            {sizes.length > 0 && (
              <div>
                <div className="text-sm font-medium mb-1">Tamanho</div>
                <div className="flex flex-wrap gap-1.5">
                  {SIZE_LABELS.map((sz) => {
                    const entry = sizes.find((s) => s.key === sz);
                    const exists = Boolean(entry);
                    const active = selectedSize === sz;
                    const title = exists
                      ? variantStockKnown
                        ? entry && entry.amount > 0
                          ? `Disponível: ${entry.amount} un.`
                          : "Esgotado neste tamanho"
                        : "Estoque desconhecido"
                      : "Tamanho indisponível para este produto";
                    return (
                      <button
                        key={sz}
                        type="button"
                        disabled={!exists}
                        onClick={() => setSelectedSize(sz)}
                        className={`px-2.5 py-1 rounded-full border text-xs ${
                          active ? "text-white border-transparent" : "text-gray-700 border-gray-200 bg-gray-50"
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
                  disabled={isOut || (stockKnown && qty >= Math.max(1, maxStock || 1))}
                >
                  +
                </button>
              </div>
              <button
                onClick={handleAddToCart}
                disabled={!product.active || adding || isOut || (sizes.length > 0 && !selectedSize)}
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
function DetailsAccordion({ title, children }: { title: string; children: React.ReactNode }) {
  const [open, setOpen] = React.useState(true);
  return (
    <div className="rounded-2xl border border-gray-100">
      <button type="button" onClick={() => setOpen((o) => !o)} className="w-full flex items-center justify-between px-3 py-2">
        <span className="text-sm font-medium">{title}</span>
        {open ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
      </button>
      {open && <div className="px-3 pb-3 text-sm text-gray-700">{children}</div>}
    </div>
  );
}

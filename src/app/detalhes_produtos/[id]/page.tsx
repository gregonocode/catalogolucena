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

/* =============== Constantes / Tipos =============== */
const ACCENT = "#01A920";
const CART_KEY = "cart_v2_sizes";

type SizeKey = "P" | "M" | "G" | "GG";
const SIZE_LABELS: SizeKey[] = ["P", "M", "G", "GG"];

type Product = {
  id: string;
  title: string;
  description: string | null;
  price_cents: number;
  active: boolean;
  amount: number | null; // para produtos sem variação
};

type ImageRow = { storage_path: string; is_primary: boolean | null };

type VariantGroupRow = { id: string; name: string; position: number; product_id: string };
type VariantOptionRow = { id: string; variant_group_id: string; value: string };

type SizeEntry = { key: SizeKey; optionId: string; amount: number };

/** Carrinho (union):
 * - COM VARIANTE: com variant_option_id/size
 * - SEM VARIANTE: sem esses campos
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
  max?: number;
};
type CartItemNoVariant = {
  id: string; // `${product_id}`
  product_id: string;
  title: string;
  price_cents: number;
  imageUrl: string | null;
  qty: number;
  max?: number;
};
type CartItem = CartItemWithVariant | CartItemNoVariant;

/* =============== Utils =============== */
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
  return readCartLS().reduce((sum, it) => sum + it.qty, 0);
}

// Type guards para evitar `any`
function isWithVariant(item: CartItem): item is CartItemWithVariant {
  return (item as CartItemWithVariant).variant_option_id !== undefined;
}

/** Insere/atualiza item no LS somando quantidades, respeitando limite (max) */
function upsertCartLS(item: Omit<CartItem, "qty">, addQty: number, max?: number): CartItem[] {
  const cart = readCartLS();
  const idx = cart.findIndex((x) => x.id === item.id);

  if (idx >= 0) {
    const cur = cart[idx];
    const limit = typeof max === "number" ? max : cur.max;
    const nextQty = limit ? Math.min(cur.qty + addQty, limit) : cur.qty + addQty;
    const updated: CartItem = { ...cur, qty: Math.max(1, nextQty), max: limit };
    const next = [...cart];
    next[idx] = updated;
    return next;
  }

  const firstQty = Math.max(1, typeof max === "number" ? Math.min(addQty, max) : addQty);
  return [...cart, { ...(item as CartItem), qty: firstQty, max }];
}

/* =============== Página =============== */
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

  // tamanhos/estoque deste produto
  const [sizes, setSizes] = React.useState<SizeEntry[]>([]);
  const [selectedSize, setSelectedSize] = React.useState<SizeKey | null>(null);

  // quantidade e carrinho
  const [qty, setQty] = React.useState(1);
  const [adding, setAdding] = React.useState(false);
  const [cartCount, setCartCount] = React.useState(0);

  React.useEffect(() => {
    setCartCount(countCartLS());
    function onStorage(e: StorageEvent) {
      if (e.key === CART_KEY) setCartCount(countCartLS());
    }
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  // Carrega produto + imagens + tamanhos (se houver)
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

        // Grupo "Tamanho" (se existir)
        const { data: gdata, error: gerr } = await supabase
          .from("variant_groups")
          .select("id, name, position, product_id")
          .eq("product_id", id)
          .eq("name", "Tamanho")
          .order("position", { ascending: true });
        if (gerr) throw gerr;

        const vGroups = (gdata ?? []) as VariantGroupRow[];
        let sizeEntries: SizeEntry[] = [];

        if (vGroups.length > 0) {
          const gid = vGroups[0].id;

          // Opções P/M/G/GG
          const { data: odata, error: oerr } = await supabase
            .from("variant_options")
            .select("id, variant_group_id, value")
            .eq("variant_group_id", gid)
            .in("value", SIZE_LABELS);
          if (oerr) throw oerr;

          const opts = (odata ?? []) as VariantOptionRow[];
          const optionIds = opts.map((o) => o.id);

          // Estoque por variante
          type PV = { product_id: string; variant_option_id: string; amount: number };
          let pvRows: PV[] = [];
          if (optionIds.length) {
            const { data: pv, error: pvErr } = await supabase
              .from("product_variants")
              .select("product_id, variant_option_id, amount")
              .eq("product_id", id)
              .in("variant_option_id", optionIds);
            if (pvErr) throw pvErr;
            pvRows = (pv ?? []) as PV[];
          }

          // Monta entries ordenadas P/M/G/GG
          sizeEntries = SIZE_LABELS.map((label) => {
            const opt = opts.find((o) => o.value === label) || null;
            const optId = opt?.id ?? "";
            const amount =
              pvRows.find((r) => r.variant_option_id === optId)?.amount ?? 0;
            return { key: label, optionId: optId, amount };
          }).filter((e) => e.optionId); // só os que existem no grupo
        }

        if (ignore) return;

        setProduct(prow);
        setImages(urls);
        setActiveImg(0);
        setSizes(sizeEntries);

        // pré-seleção: se existir apenas 1 tamanho com estoque > 0
        const withStock = sizeEntries.filter((e) => e.amount > 0);
        setSelectedSize(withStock.length === 1 ? withStock[0].key : null);
      } catch (e) {
        const msg = e instanceof Error ? e.message : "Falha ao carregar produto";
        setErr(msg);
      } finally {
        if (!ignore) setLoading(false);
      }
    })();
    return () => {
      ignore = true;
    };
  }, [id, supabase]);

  // helpers derivados
  const hasVariants = sizes.length > 0;
  const totalStock = hasVariants
    ? sizes.reduce((s, e) => s + e.amount, 0)
    : Math.max(0, Number(product?.amount ?? 0));
  const isOut = totalStock <= 0;
  const isLow = !isOut && totalStock < 10;

  // quantidade (respeita estoque disponível do contexto)
  function handleDec() {
    setQty((q) => Math.max(1, q - 1));
  }
  function handleInc() {
    const max = (() => {
      if (!hasVariants) return Math.max(1, Number(product?.amount ?? 1));
      const chosen = sizes.find((s) => s.key === selectedSize) || null;
      return Math.max(1, Number(chosen?.amount ?? 1));
    })();
    setQty((q) => Math.min(max, q + 1));
  }

  // Adicionar ao carrinho
  function handleAddToCart() {
    if (!product || !product.active) return;

    // Sem variantes
    if (!hasVariants) {
      const max = Math.max(0, Number(product.amount ?? 0));
      if (max <= 0) {
        alert("Produto esgotado no momento.");
        return;
      }
      const desired = Math.max(1, Math.min(qty, max));
      setAdding(true);
      try {
        const img = images[0] || null;
        const updated = upsertCartLS(
          {
            id: product.id,
            product_id: product.id,
            title: product.title,
            price_cents: product.price_cents,
            imageUrl: img,
          } satisfies Omit<CartItemNoVariant, "qty">,
          desired,
          max
        );
        writeCartLS(updated);
        setCartCount(countCartLS());
      } finally {
        setAdding(false);
      }
      return;
    }

    // Com variantes
    if (!selectedSize) {
      alert("Selecione um tamanho.");
      return;
    }
    const entry = sizes.find((s) => s.key === selectedSize);
    if (!entry) {
      alert("Tamanho indisponível para este produto.");
      return;
    }
    if (entry.amount <= 0) {
      alert("Este tamanho está esgotado.");
      return;
    }

    const max = entry.amount;
    const desired = Math.max(1, Math.min(qty, max));
    const img = images[0] || null;

    setAdding(true);
    try {
      const updated = upsertCartLS(
        {
          id: `${product.id}:${entry.optionId}`,
          product_id: product.id,
          variant_option_id: entry.optionId,
          size: selectedSize,
          title: product.title,
          price_cents: product.price_cents,
          imageUrl: img,
        } satisfies Omit<CartItemWithVariant, "qty">,
        desired,
        max
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
          <div className="p-3 rounded-xl border border-red-200 bg-red-50 text-sm text-red-700">
            {err}
          </div>
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

            {/* Estoque info (total) */}
            {isOut ? (
              <div className="inline-flex items-center gap-2 px-2 py-1 rounded-full text-xs text-red-700 bg-red-50 border border-red-200">
                ESGOTADO
              </div>
            ) : isLow ? (
              <div className="inline-flex items-center gap-2 px-2 py-1 rounded-full text-xs text-orange-700 bg-orange-50 border border-orange-200">
                <AlertTriangle className="w-3 h-3" />
                Restam {totalStock} un.
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

            {/* Seletor de tamanhos (quando existir) */}
            {hasVariants && (
              <div>
                <div className="text-sm font-medium mb-1">Tamanho</div>
                <div className="flex flex-wrap gap-2">
                  {SIZE_LABELS.map((sz) => {
                    const entry = sizes.find((e) => e.key === sz);
                    const exists = Boolean(entry);
                    const hasStockSz = (entry?.amount ?? 0) > 0;
                    const active = selectedSize === sz;

                    return (
                      <button
                        key={sz}
                        type="button"
                        disabled={!exists}
                        onClick={() => setSelectedSize(sz)}
                        className={`px-3 py-1.5 rounded-full border text-sm ${
                          active
                            ? "text-white border-transparent"
                            : "text-gray-700 border-gray-200 bg-gray-50"
                        } disabled:opacity-40 disabled:cursor-not-allowed`}
                        style={active ? { backgroundColor: ACCENT } : {}}
                        title={
                          !exists
                            ? "Tamanho não disponível"
                            : hasStockSz
                            ? `Disponível: ${entry?.amount} un.`
                            : "Esgotado neste tamanho"
                        }
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
                  disabled={
                    isOut ||
                    (hasVariants
                      ? qty >= (sizes.find((s) => s.key === selectedSize)?.amount ?? 1)
                      : qty >= Math.max(1, Number(product.amount ?? 1)))
                  }
                >
                  +
                </button>
              </div>
              <button
                onClick={handleAddToCart}
                disabled={!product.active || adding || isOut || (hasVariants && !selectedSize)}
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

/* =============== Accordion =============== */
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

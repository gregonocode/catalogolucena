"use client";

import React from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { ArrowLeft, ShoppingCart, Loader2, ChevronDown, ChevronUp, AlertTriangle } from "lucide-react";
import { supabaseBrowser } from "@/lib/supabase-browser";

const ACCENT = "#01A920";

/* ===================== Tipos ===================== */
type SizeKey = "P" | "M" | "G" | "GG";
const SIZE_LABELS: SizeKey[] = ["P", "M", "G", "GG"];

type Product = {
  id: string;
  title: string;
  description: string | null;
  price_cents: number;
  active: boolean;
  amount: number | null; // pode ser null para público/RLS => desconhecido
};

type ImageRow = { storage_path: string; is_primary: boolean | null };

type SizeEntry = { key: SizeKey; optionId: string; amount: number };

type CartItemVariant = {
  kind: "variant";
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
type CartItemSimple = {
  kind: "simple";
  id: string; // `${product_id}`
  product_id: string;
  title: string;
  price_cents: number;
  imageUrl: string | null;
  qty: number;
  max?: number;
};
type CartItem = CartItemVariant | CartItemSimple;

/* ===================== Utils ===================== */
const CART_KEY = "cart_v2_sizes";

function formatPrice(cents: number) {
  return (cents / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

// LS: ler, escrever, contar
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
  const items = readCartLS();
  return items.reduce((sum, it) => sum + it.qty, 0);
}

/* ===================== Página ===================== */
export default function ProductDetailsPage() {
  const params = useParams<{ id: string }>();
  const id = params.id;
  const router = useRouter();
  const supabase = supabaseBrowser();

  // UI
  const [loading, setLoading] = React.useState(true);
  const [err, setErr] = React.useState<string | null>(null);

  // Produto/imagens
  const [product, setProduct] = React.useState<Product | null>(null);
  const [images, setImages] = React.useState<string[]>([]);
  const [activeImg, setActiveImg] = React.useState(0);

  // Estoque consolidado
  const [sizes, setSizes] = React.useState<SizeEntry[]>([]); // se vazio => produto simples
  const [variantsKnown, setVariantsKnown] = React.useState(false); // sabemos amounts das variantes?
  const [baseKnown, setBaseKnown] = React.useState(false); // products.amount é conhecido?
  const [baseAmount, setBaseAmount] = React.useState(0); // amount numérico (0 quando desconhecido)

  // Seleção/quantidade
  const [selectedSize, setSelectedSize] = React.useState<SizeKey | null>(null);
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

  // Carrega produto + imagens + variantes/estoque
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

        // Grupo "Tamanho" (se houver)
        const { data: grows, error: gerr } = await supabase
          .from("variant_groups")
          .select("id, name")
          .eq("product_id", id)
          .eq("name", "Tamanho");
        if (gerr) throw gerr;

        let sizeEntries: SizeEntry[] = [];
        let knownVariants = false;

        if ((grows ?? []).length > 0) {
          const groupId = (grows ?? [])[0].id as string;

          // Opções P/M/G/GG
          const { data: optData, error: optErr } = await supabase
            .from("variant_options")
            .select("id, value, variant_group_id")
            .eq("variant_group_id", groupId)
            .in("value", SIZE_LABELS);
          if (optErr) throw optErr;

          const optionIds = (optData ?? []).map((o) => o.id as string);

          // amounts em product_variants
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

          knownVariants = pvRows.length > 0;

          // Monta os tamanhos (se não conhecemos amounts, tratamos como 0)
          sizeEntries = (optData ?? []).map((o) => {
            const key = o.value as SizeKey;
            const entryAmount =
              pvRows.find((r) => r.variant_option_id === o.id)?.amount ?? 0;
            return { key, optionId: o.id as string, amount: knownVariants ? entryAmount : 0 };
          });

          // Ordena por P/M/G/GG
          sizeEntries.sort(
            (a, b) => SIZE_LABELS.indexOf(a.key) - SIZE_LABELS.indexOf(b.key)
          );
        }

        // Base amount (produto simples) — desconhecido => 0 e baseKnown=false
        const baseIsKnown = prow.amount !== null && prow.amount !== undefined;
        const baseAmt = baseIsKnown ? (prow.amount as number) : 0;

        if (!ignore) {
          setProduct(prow);
          setImages(urls);
          setActiveImg(0);

          setSizes(sizeEntries);
          setVariantsKnown(knownVariants);

          setBaseKnown(baseIsKnown);
          setBaseAmount(baseAmt);

          // pré-seleção de tamanho quando estoque conhecido
          if (knownVariants) {
            const withStock = sizeEntries.filter((e) => e.amount > 0);
            setSelectedSize(withStock.length === 1 ? withStock[0].key : null);
          } else {
            setSelectedSize(null);
          }

          // qty inicial = 1
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

  // Estado derivado de estoque
  const hasVariants = sizes.length > 0;
  const stockKnown = hasVariants ? variantsKnown : baseKnown;
  const totalAmount = hasVariants ? sizes.reduce((s, e) => s + e.amount, 0) : baseAmount;
  const isOut = stockKnown ? totalAmount <= 0 : true; // conservador: desconhecido => esgotado
  const isLow = stockKnown && !isOut && totalAmount < 10;

  // Quantidade (respeita estoque quando conhecido; se desconhecido, não incrementa)
  function handleDec() {
    setQty((q) => Math.max(1, q - 1));
  }
  function handleInc() {
    if (!stockKnown) return; // não incrementa se desconhecido
    const max = hasVariants
      ? (() => {
          if (!selectedSize) return 1;
          const entry = sizes.find((s) => s.key === selectedSize);
          return entry ? Math.max(1, entry.amount) : 1;
        })()
      : Math.max(1, baseAmount);
    setQty((q) => Math.min(max, q + 1));
  }

  // Adicionar ao carrinho (somente se estoque conhecido e >0)
  function handleAddToCart() {
    if (!product) return;
    if (!product.active) return;
    if (isOut || !stockKnown) return;

    const currentCart = readCartLS();
    const imageUrl = images[0] || null;

    if (hasVariants) {
      if (!selectedSize) {
        alert("Escolha um tamanho antes de adicionar.");
        return;
      }
      const entry = sizes.find((s) => s.key === selectedSize);
      if (!entry || entry.amount <= 0) {
        alert("Este tamanho está esgotado.");
        return;
      }

      const max = entry.amount;
      const itemId = `${product.id}:${entry.optionId}`;
      const idx = currentCart.findIndex((x) => x.id === itemId);

      setAdding(true);
      try {
        if (idx >= 0) {
          const cur = currentCart[idx] as CartItemVariant;
          const nextQty = Math.min(cur.qty + qty, max);
          currentCart[idx] = { ...cur, qty: nextQty, max };
        } else {
          const newItem: CartItemVariant = {
            kind: "variant",
            id: itemId,
            product_id: product.id,
            variant_option_id: entry.optionId,
            size: selectedSize,
            title: product.title,
            price_cents: product.price_cents,
            imageUrl,
            qty: Math.min(qty, max),
            max,
          };
          currentCart.push(newItem);
        }
        writeCartLS(currentCart);
        setCartCount(countCartLS());
      } finally {
        setAdding(false);
      }
      return;
    }

    // simples (sem variações)
    if (!baseKnown || baseAmount <= 0) {
      alert("Produto esgotado no momento.");
      return;
    }
    const max = baseAmount;
    const itemId = product.id;
    const idx = currentCart.findIndex((x) => x.id === itemId);

    setAdding(true);
    try {
      if (idx >= 0) {
        const cur = currentCart[idx] as CartItemSimple;
        const nextQty = Math.min(cur.qty + qty, max);
        currentCart[idx] = { ...cur, qty: nextQty, max };
      } else {
        const newItem: CartItemSimple = {
          kind: "simple",
          id: product.id,
          product_id: product.id,
          title: product.title,
          price_cents: product.price_cents,
          imageUrl,
          qty: Math.min(qty, max),
          max,
        };
        currentCart.push(newItem);
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
                <p className="text-sm text-gray-700 whitespace-pre-wrap">{product.description}</p>
              ) : (
                <p className="text-sm text-gray-500">Sem descrição.</p>
              )}
            </DetailsAccordion>

            {/* Variantes (Tamanho) */}
            {sizes.length > 0 && (
              <div>
                <div className="text-sm font-medium capitalize mb-1">Tamanho</div>
                <div className="flex flex-wrap gap-2">
                  {SIZE_LABELS.map((sz) => {
                    const entry = sizes.find((e) => e.key === sz);
                    const exists = Boolean(entry);
                    const active = selectedSize === sz;

                    const title = !exists
                      ? "Tamanho não disponível para este produto"
                      : variantsKnown
                      ? entry && entry.amount > 0
                        ? `Disponível: ${entry.amount} un.`
                        : "Esgotado neste tamanho"
                      : "Estoque indisponível — não vendemos";

                    const disabled = !exists || !variantsKnown || (entry ? entry.amount <= 0 : true);

                    return (
                      <button
                        key={sz}
                        type="button"
                        onClick={() => setSelectedSize(sz)}
                        disabled={disabled}
                        className={`px-3 py-1.5 rounded-full border text-sm ${
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
                  disabled={
                    isOut ||
                    !stockKnown || // conservador
                    (hasVariants && !!selectedSize
                      ? (() => {
                          const e = sizes.find((s) => s.key === selectedSize);
                          return !e || qty >= e.amount;
                        })()
                      : (!hasVariants && qty >= baseAmount))
                  }
                >
                  +
                </button>
              </div>
              <button
                onClick={handleAddToCart}
                disabled={!product.active || adding || isOut || !stockKnown || (hasVariants && !selectedSize)}
                className="flex-1 px-3 py-3 rounded-xl text-white disabled:opacity-50"
                style={{ backgroundColor: ACCENT }}
                title={!stockKnown ? "Estoque indisponível — não vendemos" : undefined}
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

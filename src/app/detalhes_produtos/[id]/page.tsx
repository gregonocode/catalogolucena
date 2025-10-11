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
  amount: number; // estoque
};

type ImageRow = { storage_path: string; is_primary: boolean | null };

type VariantGroup = { id: string; name: string; position: number };
type RawVariantOption = {
  id: string;
  name: string;
  position: number | null;
  variant_group_id: string;
};
type VariantOption = { id: string; name: string; position: number; group_id: string };

type CartItem = { id: string; title: string; price_cents: number; imageUrl: string | null; qty: number; max?: number };

/* ===================== Utils ===================== */
const CART_KEY = "cart_v1";

function formatPrice(cents: number) {
  return (cents / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

// Lê o carrinho do localStorage
function readCartLS(): CartItem[] {
  try {
    const raw = localStorage.getItem(CART_KEY);
    return raw ? (JSON.parse(raw) as CartItem[]) : [];
  } catch {
    return [];
  }
}

// Escreve o carrinho no localStorage
function writeCartLS(items: CartItem[]) {
  try {
    localStorage.setItem(CART_KEY, JSON.stringify(items));
  } catch {
    /* noop */
  }
}

// Conta itens (somatório das quantidades)
function countCartLS(): number {
  const items = readCartLS();
  return items.reduce((sum, it) => sum + it.qty, 0);
}

// Insere/atualiza item somando quantidades, respeitando limite (max)
function upsertCartLS(item: Omit<CartItem, "qty">, addQty: number, max?: number): CartItem[] {
  const cart = readCartLS();
  const idx = cart.findIndex((x) => x.id === item.id);

  if (idx >= 0) {
    const cur = cart[idx];
    const limit = typeof max === "number" ? max : cur.max ?? undefined;
    const nextQty = limit ? Math.min(cur.qty + addQty, limit) : cur.qty + addQty;
    const next: CartItem = { ...cur, qty: Math.max(1, nextQty), max: limit };
    const updated = [...cart];
    updated[idx] = next;
    return updated;
  }

  const firstQty = Math.max(1, typeof max === "number" ? Math.min(addQty, max) : addQty);
  return [...cart, { ...item, qty: firstQty, max }];
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

  const [groups, setGroups] = React.useState<VariantGroup[]>([]);
  const [optionsByGroup, setOptionsByGroup] = React.useState<Record<string, VariantOption[]>>({});
  const [selectedOptions, setSelectedOptions] = React.useState<Record<string, string | null>>({});

  const [qty, setQty] = React.useState(1);
  const [adding, setAdding] = React.useState(false);

  // Badge do carrinho
  const [cartCount, setCartCount] = React.useState(0);
  React.useEffect(() => {
    // inicial
    setCartCount(countCartLS());
    // atualiza se mudar em outra aba/janela
    function onStorage(e: StorageEvent) {
      if (e.key === CART_KEY) setCartCount(countCartLS());
    }
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  // Carrega dados do produto
  React.useEffect(() => {
    let ignore = false;
    (async () => {
      setLoading(true);
      setErr(null);
      try {
        // Produto com estoque
        const { data: prow, error: perr } = await supabase
          .from("products")
          .select("id, title, description, price_cents, active, amount")
          .eq("id", id)
          .maybeSingle();
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

        // Variant groups
        const { data: grows, error: gerr } = await supabase
          .from("variant_groups")
          .select("id, name, position")
          .eq("product_id", id)
          .order("position", { ascending: true });
        if (gerr) throw gerr;

        const vg = (grows || []) as VariantGroup[];

        // Opções (variant_options ou variant_values)
        const optionsMap: Record<string, VariantOption[]> = {};
        if (vg.length > 0) {
          const groupIds = vg.map((g) => g.id);
          let optRows: RawVariantOption[] | null = null;

          try {
            const { data: voData, error: voErr } = await supabase
              .from("variant_options")
              .select("id, name, position, variant_group_id")
              .in("variant_group_id", groupIds)
              .order("position", { ascending: true });
            if (voErr) throw voErr;
            optRows = (voData ?? []) as RawVariantOption[];
          } catch {
            try {
              const { data: vvData, error: vvErr } = await supabase
                .from("variant_values")
                .select("id, name, position, variant_group_id")
                .in("variant_group_id", groupIds)
                .order("position", { ascending: true });
              if (vvErr) throw vvErr;
              optRows = (vvData ?? []) as RawVariantOption[];
            } catch {
              optRows = null;
            }
          }

          if (optRows) {
            for (const r of optRows) {
              const entry: VariantOption = {
                id: r.id,
                name: r.name,
                position: r.position ?? 0,
                group_id: r.variant_group_id,
              };
              optionsMap[r.variant_group_id] = [...(optionsMap[r.variant_group_id] || []), entry];
            }
            for (const gid of Object.keys(optionsMap)) {
              optionsMap[gid].sort((a, b) => a.position - b.position);
            }
          }
        }

        if (!ignore) {
          setProduct(prow as Product);
          setImages(urls);
          setActiveImg(0);
          setGroups(vg);
          setOptionsByGroup(optionsMap);
          const defaults: Record<string, string | null> = {};
          vg.forEach((g) => (defaults[g.id] = null));
          setSelectedOptions(defaults);
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

  const allGroupsSelected = React.useMemo(() => {
    if (groups.length === 0) return true;
    return groups.every((g) => {
      const opts = optionsByGroup[g.id];
      if (!opts || opts.length === 0) return true;
      return Boolean(selectedOptions[g.id]);
    });
  }, [groups, optionsByGroup, selectedOptions]);

  // Quantidade (respeita estoque)
  function handleDec() {
    setQty((q) => Math.max(1, q - 1));
  }
  function handleInc() {
    const max = product?.amount ?? 1;
    setQty((q) => Math.min(max, q + 1));
  }

  // Adicionar ao carrinho: grava direto no localStorage e atualiza badge
  function handleAddToCart() {
    if (!product) return;
    if (!product.active) return;
    if (!allGroupsSelected) return;

    const max = product.amount ?? 0;
    if (max <= 0) {
      alert("Produto esgotado no momento.");
      return;
    }

    const desired = Math.max(1, Math.min(qty, max));
    setAdding(true);
    try {
      const img = images[0] || null;
      const updated = upsertCartLS(
        { id: product.id, title: product.title, price_cents: product.price_cents, imageUrl: img },
        desired,
        max
      );
      writeCartLS(updated);
      setCartCount(countCartLS()); // atualiza badge
      // opcional: router.push("/") para mostrar a Home com o badge já atualizado
    } finally {
      setAdding(false);
    }
  }

  const isOut = (product?.amount ?? 0) <= 0;
  const isLow = !isOut && (product?.amount ?? 0) < 10;

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
                Restam {product.amount} un.
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

            {/* Variantes */}
            {groups.length > 0 && (
              <div className="space-y-3">
                {groups.map((g) => {
                  const opts = optionsByGroup[g.id] || [];
                  if (opts.length === 0) {
                    return (
                      <div key={g.id}>
                        <div className="text-sm font-medium capitalize">{g.name}</div>
                        <div className="text-xs text-gray-500">Opções em breve</div>
                      </div>
                    );
                  }
                  const selected = selectedOptions[g.id];
                  return (
                    <div key={g.id}>
                      <div className="text-sm font-medium capitalize mb-1">{g.name}</div>
                      <div className="flex flex-wrap gap-2">
                        {opts.map((o) => {
                          const active = selected === o.id;
                          return (
                            <button
                              key={o.id}
                              type="button"
                              onClick={() => setSelectedOptions((prev) => ({ ...prev, [g.id]: o.id }))}
                              className={`px-3 py-1.5 rounded-full border text-sm ${
                                active ? "text-white border-transparent" : "text-gray-700 border-gray-200 bg-gray-50"
                              }`}
                              style={active ? { backgroundColor: ACCENT } : {}}
                            >
                              {o.name}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  );
                })}
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
                  disabled={isOut || qty >= (product.amount ?? 1)}
                >
                  +
                </button>
              </div>
              <button
                onClick={handleAddToCart}
                disabled={!product.active || adding || !allGroupsSelected || isOut}
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

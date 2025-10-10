"use client";

import React from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { ArrowLeft, ShoppingCart, Loader2, ChevronDown, ChevronUp } from "lucide-react";
import { supabaseBrowser } from "@/lib/supabase-browser";

const ACCENT = "#01A920";

type Product = {
  id: string;
  title: string;
  description: string | null;
  price_cents: number;
  active: boolean;
};

type ImageRow = { storage_path: string; is_primary: boolean | null };

type VariantGroup = { id: string; name: string; position: number };

type VariantOption = { id: string; name: string; position: number; group_id: string };

type CartItem = { id: string; title: string; price_cents: number; imageUrl: string | null; qty: number };

function formatPrice(cents: number) {
  return (cents / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

export default function ProductDetailsPage() {
  const { id } = useParams<{ id: string }>();
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

  // Carrinho localStorage (mesmo esquema da home)
  const [cart, setCart] = React.useState<CartItem[]>([]);
  React.useEffect(() => {
    try {
      const raw = localStorage.getItem("cart_v1");
      if (raw) setCart(JSON.parse(raw));
    } catch {}
  }, []);
  React.useEffect(() => {
    try {
      localStorage.setItem("cart_v1", JSON.stringify(cart));
    } catch {}
  }, [cart]);

  function addToCart(item: Omit<CartItem, "qty">, quantity: number) {
    setCart((c) => {
      const i = c.findIndex((x) => x.id === item.id);
      if (i >= 0) {
        const next = [...c];
        next[i] = { ...next[i], qty: next[i].qty + quantity };
        return next;
      }
      return [...c, { ...item, qty: quantity }];
    });
  }

  React.useEffect(() => {
    let ignore = false;
    (async () => {
      setLoading(true);
      setErr(null);
      try {
        // 1) Produto
        const { data: prow, error: perr } = await supabase
          .from("products")
          .select("id, title, description, price_cents, active")
          .eq("id", id)
          .maybeSingle();
        if (perr) throw perr;
        if (!prow) throw new Error("Produto não encontrado");

        // 2) Imagens (todas) - bucket 'produtos'
        const { data: irows, error: ierr } = await supabase
          .from("product_images")
          .select("storage_path, is_primary")
          .eq("product_id", id)
          .order("is_primary", { ascending: false })
          .order("created_at", { ascending: false });
        if (ierr) throw ierr;

        const urls: string[] = (irows as ImageRow[] | null)?.map((r) => {
          const { data } = supabase.storage.from("produtos").getPublicUrl(r.storage_path);
          return data.publicUrl;
        }) || [];

        // 3) Variant groups
        const { data: grows, error: gerr } = await supabase
          .from("variant_groups")
          .select("id, name, position")
          .eq("product_id", id)
          .order("position", { ascending: true });
        if (gerr) throw gerr;

        const vg = (grows || []) as VariantGroup[];

        // 4) Tentar buscar opções em tabelas mais comuns (opcional).
        //    Se sua tabela se chama diferente, pode ajustar abaixo.
        const options: Record<string, VariantOption[]> = {};

        if (vg.length > 0) {
          const groupIds = vg.map((g) => g.id);

          // tentar 'variant_options'
          let optRows: any[] | null = null;
          let optErr: any | null = null;
          try {
            const { data, error } = await supabase
              .from("variant_options")
              .select("id, name, position, variant_group_id")
              .in("variant_group_id", groupIds)
              .order("position", { ascending: true });
            optRows = data as any[] | null;
            optErr = error;
          } catch (e) {
            optErr = e;
          }

          // fallback: tentar 'variant_values'
          if (optErr || !optRows) {
            try {
              const { data, error } = await supabase
                .from("variant_values")
                .select("id, name, position, variant_group_id")
                .in("variant_group_id", groupIds)
                .order("position", { ascending: true });
              optRows = data as any[] | null;
              optErr = error;
            } catch (e) {
              // se também falhar, seguimos sem opções
            }
          }

          if (optRows && Array.isArray(optRows)) {
            for (const r of optRows) {
              const gid = r.variant_group_id as string;
              const entry: VariantOption = {
                id: r.id,
                name: r.name,
                position: r.position ?? 0,
                group_id: gid,
              };
              options[gid] = [...(options[gid] || []), entry];
            }
            // ordenar cada grupo por position
            for (const gid of Object.keys(options)) {
              options[gid].sort((a, b) => a.position - b.position);
            }
          }

          if (!ignore) {
            setGroups(vg);
            setOptionsByGroup(options);
            // default: nenhuma selecionada
            const defaults: Record<string, string | null> = {};
            vg.forEach((g) => (defaults[g.id] = null));
            setSelectedOptions(defaults);
          }
        }

        if (!ignore) {
          setProduct(prow as Product);
          setImages(urls);
          setActiveImg(0);
        }
      } catch (e: any) {
        console.error(e);
        if (!ignore) setErr(e?.message || "Falha ao carregar produto");
      } finally {
        if (!ignore) setLoading(false);
      }
    })();
    return () => {
      ignore = true;
    };
  }, [id, supabase]);

  function handleSelectOption(groupId: string, optionId: string) {
    setSelectedOptions((prev) => ({ ...prev, [groupId]: optionId }));
  }

  function handleAddToCart() {
    if (!product) return;
    setAdding(true);
    try {
      const img = images[0] || null;
      addToCart({ id: product.id, title: product.title, price_cents: product.price_cents, imageUrl: img }, qty);
    } finally {
      setAdding(false);
    }
  }

  const allGroupsSelected = React.useMemo(() => {
    if (groups.length === 0) return true; // se não há grupos, ok
    return groups.every((g) => {
      const opts = optionsByGroup[g.id];
      if (!opts || opts.length === 0) return true; // sem opções cadastradas
      return Boolean(selectedOptions[g.id]);
    });
  }, [groups, optionsByGroup, selectedOptions]);

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
            className="p-2 rounded-xl border border-gray-200 bg-white shadow-sm active:scale-[0.98]"
            aria-label="Ir ao início"
          >
            <ShoppingCart className="w-5 h-5" />
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
                  <div className="w-16 h-16 rounded-lg bg-gray-200" />)
                }
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
                      className={`h-16 w-12 object-cover rounded-lg border ${i === activeImg ? "border-gray-900" : "border-gray-200"} cursor-pointer`}
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
                              onClick={() => handleSelectOption(g.id, o.id)}
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
                <button onClick={() => setQty((q) => Math.max(1, q - 1))} className="w-8 h-8 grid place-items-center">-</button>
                <span className="w-8 text-center select-none">{qty}</span>
                <button onClick={() => setQty((q) => q + 1)} className="w-8 h-8 grid place-items-center">+</button>
              </div>
              <button
                onClick={handleAddToCart}
                disabled={!product.active || adding || !allGroupsSelected}
                className="flex-1 px-3 py-3 rounded-xl text-white disabled:opacity-50"
                style={{ backgroundColor: ACCENT }}
              >
                {adding ? <Loader2 className="w-4 h-4 animate-spin inline mr-2" /> : null}
                Adicionar ao carrinho
              </button>
            </div>

            {!product.active && (
              <div className="p-3 rounded-xl border border-yellow-200 bg-yellow-50 text-sm text-yellow-800">
                Produto inativo no momento.
              </div>
            )}

            {/* Link para início */}
            <div className="text-center pt-2">
              <Link href="/" className="text-sm underline text-gray-600">Voltar para a loja</Link>
            </div>
          </div>
        )}
      </section>
    </main>
  );
}

function DetailsAccordion({ title, children }: { title: string; children: React.ReactNode }) {
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

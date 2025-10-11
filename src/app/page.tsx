"use client";

import React from "react";
import { Menu, Search, ShoppingCart, Heart, AlertTriangle } from "lucide-react";
import { supabaseBrowser } from "@/lib/supabase-browser";
import Link from "next/link";

// Accent color
const ACCENT = "#01A920";

type Category = { id: string; name: string; slug: string };
type ProductRow = {
  id: string;
  title: string;
  price_cents: number;
  amount: number; // ✅ estoque
  product_images: { storage_path: string; is_primary: boolean }[] | null;
  product_categories: { category_id: string }[] | null;
};

type ProductCard = {
  id: string;
  title: string;
  price_cents: number;
  amount: number; // ✅ estoque
  imageUrl: string | null;
  categoryIds: string[];
};

type CartItem = {
  id: string;
  title: string;
  price_cents: number;
  imageUrl: string | null;
  qty: number;
  max?: number; // opcional, para mostrar limite
};

type StoreSettings = {
  id: string;
  store_name: string | null;
  whatsapp_e164: string | null;
  link_banner: string | null;
};

function formatPrice(cents: number) {
  return (cents / 100).toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL",
    minimumFractionDigits: 2,
  });
}

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

  // Helpers
  function orderCode(id: number) {
    return `#${String(id).padStart(5, "0")}`;
  }
  function normalizePhoneForWa(me: string | null): string | null {
    if (!me) return null;
    const digits = me.replace(/\D/g, "");
    if (!digits) return null;
    return digits.startsWith("55") ? digits : `55${digits}`;
  }

  // Carrinho com respeito ao estoque
  function addToCart(p: ProductCard) {
    if (p.amount <= 0) return; // bloqueia item esgotado
    setCart((c) => {
      const i = c.findIndex((x) => x.id === p.id);
      if (i >= 0) {
        const next = [...c];
        const currentQty = next[i].qty;
        const nextQty = Math.min(currentQty + 1, p.amount); // clamp
        next[i] = { ...next[i], qty: nextQty, max: p.amount };
        return next;
      }
      return [
        ...c,
        {
          id: p.id,
          title: p.title,
          price_cents: p.price_cents,
          imageUrl: p.imageUrl,
          qty: 1,
          max: p.amount,
        },
      ];
    });
  }
  function inc(id: string) {
    const max = products.find((p) => p.id === id)?.amount ?? undefined;
    setCart((c) =>
      c.map((it) =>
        it.id === id ? { ...it, qty: Math.min(it.qty + 1, max ?? it.qty + 1), max } : it
      )
    );
  }
  function dec(id: string) {
    setCart((c) =>
      c.flatMap((it) => {
        if (it.id !== id) return [it];
        const q = it.qty - 1;
        return q <= 0 ? [] : [{ ...it, qty: q }];
      })
    );
  }
  function removeItem(id: string) {
    setCart((c) => c.filter((it) => it.id !== id));
  }
  function clearCart() {
    setCart([]);
  }

  const cartCount = cart.reduce((sum, it) => sum + it.qty, 0);
  const cartTotal = cart.reduce((sum, it) => sum + it.price_cents * it.qty, 0);

  // Carregar categorias + produtos + store_settings
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

      if (catsRes.error) {
        setErr(catsRes.error.message);
        setLoading(false);
        return;
      }
      setCategories((catsRes.data ?? []) as Category[]);

      if (prodsRes.error) {
        setErr(prodsRes.error.message);
        setLoading(false);
        return;
      }
      const mapped: ProductCard[] = (prodsRes.data as ProductRow[]).map((p) => {
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
        return {
          id: p.id,
          title: p.title,
          price_cents: p.price_cents,
          amount: p.amount ?? 0,
          imageUrl,
          categoryIds,
        };
      });
      setProducts(mapped);

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

  // ====== Checkout: cria pedido pendente + redireciona ======
  function buildWhatsappText(orderId: number): string {
    const lines: string[] = [];
    lines.push(`Olá! Quero finalizar o pedido *${orderCode(orderId)}* na *${storeName}*.`);
    lines.push("");
    lines.push("Itens:");
    cart.forEach((it) => {
      lines.push(
        `• ${it.qty} x ${it.title} — ${formatPrice(it.price_cents)} = ${formatPrice(
          it.price_cents * it.qty
        )}`
      );
    });
    lines.push("");
    lines.push(`*Total:* ${formatPrice(cartTotal)}`);
    lines.push("");
    lines.push("Por favor, me informe forma de pagamento e prazo de entrega.");
    return lines.join("\n");
  }

  async function createPendingOrder() {
    // cria o pedido
    const { data: order, error: orderErr } = await supabase
      .from("orders")
      .insert({})
      .select("id")
      .single<{ id: number }>();
    if (orderErr) throw orderErr;

    // insere itens
    const itemsPayload = cart.map((it) => ({
      order_id: order.id,
      product_id: it.id,
      quantity: it.qty,
      price_cents: it.price_cents,
    }));
    const { error: itemsErr } = await supabase.from("order_items").insert(itemsPayload);
    if (itemsErr) throw itemsErr;

    return order.id;
  }

  async function handleCheckout() {
    if (cart.length === 0 || submitting) return;

    // valida estoque atual vs carrinho (defensivo – caso o admin tenha alterado no meio tempo)
const ids = cart.map((c) => c.id);
const { data: fresh, error: freshErr } = await supabase
  .from("products")
  .select("id, amount")
  .in("id", ids);
if (freshErr) {
  alert("Erro ao validar estoque. Tente novamente.");
  return;
}

// ✅ tipa o array retornado
type FreshProduct = { id: string; amount: number };
const freshProducts: FreshProduct[] = (fresh ?? []) as FreshProduct[];

// ✅ monta o mapa sem any
const stockMap = new Map<string, number>(
  freshProducts.map((r) => [r.id, r.amount])
);

for (const it of cart) {
  const available = stockMap.get(it.id) ?? 0;
  if (available <= 0) {
    alert(`"${it.title}" está esgotado. Remova do carrinho para continuar.`);
    return;
  }
  if (it.qty > available) {
    alert(`Quantidade de "${it.title}" excede o estoque (${available}). Ajuste o carrinho.`);
    return;
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

      // 1) cria pedido pendente + itens
      const orderId = await createPendingOrder();

      // 2) monta mensagem e redireciona
      const text = encodeURIComponent(buildWhatsappText(orderId));
      const url = `https://wa.me/${phone}?text=${text}`;
      // limpa carrinho e abre wa.me
      clearCart();
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
              const isOut = p.amount <= 0;
              const isLow = !isOut && p.amount < 10;
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

                      {isOut ? (
                        <span className="px-2 py-1 rounded-full text-xs text-red-700 bg-red-50 border border-red-200">
                          ESGOTADO
                        </span>
                      ) : (
                        <button
                          aria-label="Adicionar ao carrinho"
                          onClick={() => addToCart(p)}
                          className="p-2 rounded-full shadow-sm"
                          style={{ backgroundColor: ACCENT }}
                        >
                          <ShoppingCart className="w-4 h-4 text-white" />
                        </button>
                      )}
                    </div>

                    {/* Estoque baixo */}
                    {!isOut && isLow && (
                      <div className="mt-2 inline-flex items-center gap-1 text-[11px] text-orange-700 bg-orange-50 border border-orange-200 px-2 py-0.5 rounded-full">
                        <AlertTriangle className="w-3 h-3" />
                        <span>Restam {p.amount} un.</span>
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
                  const max = products.find((p) => p.id === it.id)?.amount ?? it.max;
                  const atMax = typeof max === "number" && it.qty >= max;
                  return (
                    <div key={it.id} className="flex items-center gap-3 p-2 rounded-xl border border-gray-100 bg-white shadow-sm">
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
                        <div className="text-xs text-gray-500">{formatPrice(it.price_cents)}</div>
                        <div className="mt-1 inline-flex items-center gap-2">
                          <button
                            onClick={() => dec(it.id)}
                            className="w-7 h-7 rounded-lg border border-gray-200 grid place-items-center"
                          >
                            -
                          </button>
                          <span className="text-sm w-6 text-center">{it.qty}</span>
                          <button
                            onClick={() => inc(it.id)}
                            className="w-7 h-7 rounded-lg border border-gray-200 grid place-items-center disabled:opacity-50"
                            disabled={atMax}
                            title={atMax ? "Limite de estoque" : undefined}
                          >
                            +
                          </button>
                          <button onClick={() => removeItem(it.id)} className="ml-2 text-xs underline text-gray-600">
                            remover
                          </button>
                        </div>
                        {typeof max === "number" && (
                          <div className="text-[11px] text-gray-500 mt-1">Estoque disponível: {max}</div>
                        )}
                      </div>
                      <div className="text-sm font-semibold">{formatPrice(it.price_cents * it.qty)}</div>
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
                <button onClick={clearCart} className="flex-1 px-3 py-2 rounded-xl border border-gray-200">
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
    </main>
  );
}

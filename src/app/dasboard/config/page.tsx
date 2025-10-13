// src/app/dasboard/config/page.tsx
"use client";

import React from "react";
import {
  Loader2,
  Image as ImageIcon,
  Upload,
  Trash2,
  Check,
  X,
  RefreshCw,
} from "lucide-react";
import { supabaseBrowser } from "@/lib/supabase-browser";
import type { PostgrestError } from "@supabase/supabase-js";

const ACCENT = "#01A920";

type StoreSettings = {
  id: string;
  store_name: string | null;
  whatsapp_e164: string | null;
  link_banner: string | null;
};

function isPgErr(e: unknown): e is PostgrestError {
  return typeof e === "object" && e !== null && "message" in e && "code" in e;
}

export default function StoreConfigPage() {
  const supabase = supabaseBrowser();

  const [loading, setLoading] = React.useState(true);
  const [saving, setSaving] = React.useState(false);
  const [ok, setOk] = React.useState<string | null>(null);
  const [err, setErr] = React.useState<string | null>(null);

  const [rowId, setRowId] = React.useState<string | null>(null);
  const [storeName, setStoreName] = React.useState("");
  const [whatsE164, setWhatsE164] = React.useState("");
  const [bannerUrl, setBannerUrl] = React.useState<string | null>(null);
  const [bannerFile, setBannerFile] = React.useState<File | null>(null);

  // ===== Helpers =====
  function onlyDigits(s: string) {
    return Array.from(s)
      .filter((c) => c >= "0" && c <= "9")
      .join("");
  }
  function normalizeToE164BR(input: string) {
    const digits = onlyDigits(input);
    if (!digits) return "";
    if (digits.startsWith("55")) return "+" + digits;
    return "+55" + digits;
  }
  function folderFor(id: string) {
    return `store/${id}`;
  }

  async function listFolderFiles(folderPath: string) {
    // Supabase list() usa o path de “diretório”; garantindo sem barra final
    const clean = folderPath.replace(/\/+$/, "");
    const { data, error } = await supabase.storage
      .from("banner")
      .list(clean, { limit: 100, offset: 0 }); // ajuste se precisar paginação
    if (error) throw error;
    return data ?? [];
  }

  async function removeAllInFolderExcept(folderPath: string, keepBasename?: string) {
    const files = await listFolderFiles(folderPath);
    const toDelete = files
      .filter((f) => (keepBasename ? f.name !== keepBasename : true))
      .map((f) => `${folderPath.replace(/\/+$/, "")}/${f.name}`);
    if (toDelete.length) {
      const { error: remErr } = await supabase.storage.from("banner").remove(toDelete);
      if (remErr) throw remErr;
    }
  }

  async function removeAllInFolder(folderPath: string) {
    await removeAllInFolderExcept(folderPath, undefined);
  }

  // ===== Data load =====
  async function loadSettings() {
    setLoading(true);
    setErr(null);
    setOk(null);
    try {
      const { data, error } = await supabase
        .from("store_settings")
        .select("id, store_name, whatsapp_e164, link_banner, created_at")
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (error) throw error;

      if (!data) {
        const { data: inserted, error: insErr } = await supabase
          .from("store_settings")
          .insert({ store_name: "Minha Loja", whatsapp_e164: null, link_banner: null })
          .select("id, store_name, whatsapp_e164, link_banner")
          .single();
        if (insErr) throw insErr;
        applySettings(inserted as StoreSettings);
      } else {
        applySettings(data as StoreSettings);
      }
    } catch (e: unknown) {
      console.error(e);
      setErr(isPgErr(e) ? e.message : (e as Error)?.message ?? "Falha ao carregar configurações");
    } finally {
      setLoading(false);
    }
  }

  function applySettings(s: StoreSettings) {
    setRowId(s.id);
    setStoreName(s.store_name ?? "");
    setWhatsE164(s.whatsapp_e164 ?? "");
    setBannerUrl(s.link_banner ?? null);
    setBannerFile(null);
  }

  React.useEffect(() => {
    let ignore = false;
    (async () => {
      if (ignore) return;
      await loadSettings();
    })();
    return () => {
      ignore = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ===== Save =====
  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setOk(null);
    setErr(null);

    try {
      if (!rowId) throw new Error("Linha de configurações não encontrada");
      if (!storeName.trim()) throw new Error("Informe o nome da loja");

      const normalizedWhats = whatsE164.trim() ? normalizeToE164BR(whatsE164.trim()) : null;

      let finalBannerUrl: string | null = bannerUrl ?? null;

      // Upload + limpeza para manter somente 1 imagem no bucket
      if (bannerFile) {
        const baseFolder = folderFor(rowId); // ex.: store/UUID
        const basename = `${Date.now()}-${bannerFile.name}`;
        const fullPath = `${baseFolder}/${basename}`;

        // 1) Sobe o novo arquivo
        const { error: upErr } = await supabase.storage
          .from("banner")
          .upload(fullPath, bannerFile, {
            cacheControl: "3600",
            upsert: true,
            contentType: bannerFile.type || undefined,
          });
        if (upErr) throw upErr;

        const { data } = supabase.storage.from("banner").getPublicUrl(fullPath);
        finalBannerUrl = data.publicUrl;

        // 2) Remove tudo que não for o arquivo recém-enviado
        await removeAllInFolderExcept(baseFolder, basename);
      }

      // Atualiza a tabela
      const { error: updErr } = await supabase
        .from("store_settings")
        .update({
          store_name: storeName.trim(),
          whatsapp_e164: normalizedWhats,
          link_banner: finalBannerUrl,
        })
        .eq("id", rowId);
      if (updErr) throw updErr;

      // Recarrega a linha (garantir consistência visual)
      const { data: refreshed, error: selErr } = await supabase
        .from("store_settings")
        .select("id, store_name, whatsapp_e164, link_banner")
        .eq("id", rowId)
        .maybeSingle();
      if (selErr) throw selErr;

      setBannerUrl(refreshed?.link_banner ?? finalBannerUrl);
      setStoreName(refreshed?.store_name ?? storeName);
      setWhatsE164(refreshed?.whatsapp_e164 ?? normalizedWhats ?? "");
      setBannerFile(null);
      setOk("Configurações salvas com sucesso!");
    } catch (e: unknown) {
      console.error(e);
      setErr(isPgErr(e) ? e.message : (e as Error)?.message ?? "Erro ao salvar configurações");
    } finally {
      setSaving(false);
    }
  }

  // ===== Remove banner (e limpa a pasta toda) =====
  async function handleRemoveBanner() {
    if (!rowId) return;
    setSaving(true);
    setOk(null);
    setErr(null);

    try {
      // 1) Apaga o link do DB
      const { error } = await supabase
        .from("store_settings")
        .update({ link_banner: null })
        .eq("id", rowId);
      if (error) throw error;

      // 2) Remove TODOS os arquivos do diretório do banner
      await removeAllInFolder(folderFor(rowId));

      // 3) Estado
      setBannerUrl(null);
      setBannerFile(null);
      setOk("Banner removido");
    } catch (e: unknown) {
      console.error(e);
      setErr(isPgErr(e) ? e.message : (e as Error)?.message ?? "Erro ao remover banner");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="max-w-screen-sm mx-auto">
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-lg font-semibold">Configurações da Loja</h1>
        <button
          onClick={loadSettings}
          className="inline-flex items-center gap-1 text-xs px-2 py-1 rounded-xl border border-gray-200 bg-white shadow-sm active:scale-[0.99]"
        >
          <RefreshCw className="w-4 h-4" /> Recarregar
        </button>
      </div>

      {loading ? (
        <div className="p-3 rounded-xl border border-gray-100 bg-gray-50 text-sm text-gray-600">
          Carregando configurações...
        </div>
      ) : (
        <form onSubmit={handleSave} className="space-y-5">
          {/* Nome da loja */}
          <div className="space-y-1">
            <label className="text-sm text-gray-700">Nome da loja</label>
            <input
              required
              value={storeName}
              onChange={(e) => setStoreName(e.target.value)}
              placeholder="Ex.: Loja Lucena"
              className="w-full px-3 py-2 rounded-xl border border-gray-200 focus:outline-none focus:ring-4"
            />
          </div>

          {/* WhatsApp (E.164) */}
          <div className="space-y-1">
            <label className="text-sm text-gray-700">WhatsApp (E.164)</label>
            <input
              value={whatsE164}
              onChange={(e) => setWhatsE164(e.target.value)}
              placeholder="Ex.: +5591999999999"
              className="w-full px-3 py-2 rounded-xl border border-gray-200 focus:outline-none focus:ring-4"
            />
            <p className="text-xs text-gray-500">
              Use o formato internacional, ex.: +55DDDXXXXXXXX
            </p>
          </div>

          {/* Banner */}
          <div className="space-y-2">
            <label className="text-sm text-gray-700">
              Banner da loja — Proporção ideal Mobile 1190 × 462 px
            </label>

            {bannerUrl ? (
              <div className="rounded-2xl border border-gray-100 overflow-hidden">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={bannerUrl} alt="Banner atual" className="w-full h-36 object-cover" />
              </div>
            ) : (
              <div className="h-36 rounded-2xl bg-gray-100 border border-gray-100 grid place-items-center text-gray-500 text-sm">
                Sem banner
              </div>
            )}

            <label className="flex items-center gap-3 p-3 rounded-xl border border-dashed border-gray-300 cursor-pointer">
              <input
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(e) => setBannerFile(e.target.files?.[0] ?? null)}
              />
              <span className="grid place-items-center w-10 h-10 rounded-lg bg-gray-100 border border-gray-200">
                <ImageIcon className="w-5 h-5 text-gray-600" />
              </span>
              <div className="flex-1">
                <div className="text-sm">Clique para selecionar novo banner</div>
                <div className="text-xs text-gray-500">PNG ou JPG até 5MB</div>
              </div>
              {bannerFile ? (
                <span className="text-xs text-gray-600 truncate max-w-[160px]">
                  {bannerFile.name}
                </span>
              ) : (
                <Upload className="w-4 h-4 text-gray-500" />
              )}
            </label>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={handleRemoveBanner}
                disabled={!bannerUrl || saving}
                className="inline-flex items-center gap-2 px-3 py-2 rounded-xl border border-gray-200 text-red-600 disabled:opacity-50"
              >
                <Trash2 className="w-4 h-4" /> Remover banner atual
              </button>
            </div>
          </div>

          <div className="flex items-center gap-2 pt-1">
            <button
              type="submit"
              disabled={saving}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-xl text-white shadow-sm active:scale-[0.99]"
              style={{ backgroundColor: ACCENT }}
            >
              {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
              <span>Salvar configurações</span>
            </button>

            {ok && (
              <span className="inline-flex items-center gap-1 text-sm text-emerald-700 bg-emerald-50 border border-emerald-200 px-2 py-1 rounded-xl">
                <Check className="w-4 h-4" /> {ok}
              </span>
            )}
            {err && (
              <span className="inline-flex items-center gap-1 text-sm text-red-700 bg-red-50 border border-red-200 px-2 py-1 rounded-xl">
                <X className="w-4 h-4" /> {err}
              </span>
            )}
          </div>
        </form>
      )}

      <div className="mt-6 p-3 rounded-xl border border-gray-100 bg-gray-50 text-xs text-gray-600">
        <p className="mb-1 font-medium">Como funciona</p>
        <ol className="list-decimal ml-4 space-y-1">
          <li>
            Esta página carrega (ou cria) uma linha em <code>store_settings</code>.
          </li>
          <li>
            Você pode atualizar <strong>nome da loja</strong>, <strong>WhatsApp</strong> e enviar um{" "}
            <strong>banner</strong>.
          </li>
          <li>
            O banner é salvo no bucket <code>banner</code> em <code>store/{"{id}"}</code>. O
            sistema mantém **apenas 1 arquivo** nesse diretório.
          </li>
        </ol>
      </div>
    </div>
  );
}

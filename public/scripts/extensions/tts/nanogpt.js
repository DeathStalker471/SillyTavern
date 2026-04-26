import { event_types, eventSource, getRequestHeaders, substituteParams } from '../../../script.js';
import { SECRET_KEYS, secret_state } from '../../secrets.js';
import { getPreviewString, initVoiceMap, saveTtsProviderSettings } from './index.js';

export { NanoGptTtsProvider };

class NanoGptTtsProvider {
    settings;
    models = [];
    voices = [];
    separator = ' . ';
    audioElement = document.createElement('audio');

    defaultSettings = {
        voiceMap: {},
        model: 'gpt-4o-mini-tts',
        voice: 'alloy',
        speed: 1,
        response_format: 'mp3',
        instructions: '',
    };

    get settingsHtml() {
        return `
        <div class="flex-container alignItemsCenter">
            <div class="flex1">NanoGPT TTS API</div>
            <div id="nanogpt_tts_key" class="menu_button menu_button_icon manage-api-keys" data-key="api_key_nanogpt">
                <i class="fa-solid fa-key"></i>
                <span>API Key</span>
            </div>
        </div>
        <div class="flex-container flexGap10 wrap">
            <div class="flex1">
                <label for="nanogpt_tts_model">Model</label>
                <select id="nanogpt_tts_model" class="text_pole"></select>
            </div>
            <div>
                <label for="nanogpt_tts_format">Format</label>
                <select id="nanogpt_tts_format" class="text_pole">
                    <option value="mp3">mp3</option>
                    <option value="wav">wav</option>
                    <option value="ogg">ogg</option>
                    <option value="opus">opus</option>
                    <option value="aac">aac</option>
                    <option value="flac">flac</option>
                </select>
            </div>
            <div>
                <label for="nanogpt_tts_speed">Speed <span id="nanogpt_tts_speed_output"></span></label>
                <input type="range" id="nanogpt_tts_speed" value="1" min="0.25" max="4" step="0.05">
            </div>
        </div>
        <div id="nanogpt_tts_instructions_block">
            <label for="nanogpt_tts_instructions">Instructions</label>
            <textarea id="nanogpt_tts_instructions" class="textarea_compact autoSetHeight" placeholder="Speak in a warm, friendly tone."></textarea>
        </div>`;
    }

    constructor() {
        this.handler = async function (/** @type {string} */ key) {
            if (key !== SECRET_KEYS.NANOGPT) return;
            $('#nanogpt_tts_key').toggleClass('success', !!secret_state[SECRET_KEYS.NANOGPT]);
            await this.onRefreshClick();
        }.bind(this);
    }

    dispose() {
        [event_types.SECRET_WRITTEN, event_types.SECRET_DELETED, event_types.SECRET_ROTATED].forEach(event => {
            eventSource.removeListener(event, this.handler);
        });
    }

    async loadSettings(settings) {
        this.settings = { ...this.defaultSettings, ...settings };

        $('#nanogpt_tts_key').toggleClass('success', !!secret_state[SECRET_KEYS.NANOGPT]);
        [event_types.SECRET_WRITTEN, event_types.SECRET_DELETED, event_types.SECRET_ROTATED].forEach(event => {
            eventSource.on(event, this.handler);
        });

        await this.loadModels();
        this.populateModelSelect();
        this.applySettingsToUi();
        this.bindSettings();
        await this.checkReady();
    }

    applySettingsToUi() {
        $('#nanogpt_tts_model').val(this.settings.model);
        $('#nanogpt_tts_format').val(this.settings.response_format);
        $('#nanogpt_tts_speed').val(this.settings.speed);
        $('#nanogpt_tts_speed_output').text(this.settings.speed);
        $('#nanogpt_tts_instructions').val(this.settings.instructions);
    }

    bindSettings() {
        $('#nanogpt_tts_model').on('change', async () => {
            const previousModel = this.settings.model;
            this.onSettingsChange();
            if (previousModel !== this.settings.model) {
                this.voices = await this.fetchTtsVoiceObjects();
                await initVoiceMap();
            }
        });
        $('#nanogpt_tts_format').on('change', () => this.onSettingsChange());
        $('#nanogpt_tts_speed').on('input', () => this.onSettingsChange());
        $('#nanogpt_tts_instructions').on('input', () => this.onSettingsChange());
    }

    onSettingsChange() {
        this.settings.model = String($('#nanogpt_tts_model').val() || this.settings.model);
        this.settings.response_format = String($('#nanogpt_tts_format').val() || this.defaultSettings.response_format);
        this.settings.speed = Number($('#nanogpt_tts_speed').val());
        this.settings.instructions = String($('#nanogpt_tts_instructions').val() || '');
        $('#nanogpt_tts_speed_output').text(this.settings.speed);
        saveTtsProviderSettings();
    }

    async checkReady() {
        if (!secret_state[SECRET_KEYS.NANOGPT]) {
            throw new Error('NanoGPT API key is required');
        }

        this.voices = await this.fetchTtsVoiceObjects();
    }

    async onRefreshClick() {
        await this.loadModels();
        this.populateModelSelect();
        this.applySettingsToUi();
        this.voices = await this.fetchTtsVoiceObjects();
        saveTtsProviderSettings();
    }

    async loadModels() {
        try {
            const response = await fetch('/api/speech/nanogpt/models', {
                method: 'POST',
                headers: getRequestHeaders(),
                body: JSON.stringify({}),
            });

            if (!response.ok) {
                throw new Error(`HTTP ${response.status}: ${await response.text()}`);
            }

            const data = await response.json();
            this.models = Array.isArray(data?.data) ? data.data : [];

            if (this.models.length && !this.models.find(model => model.id === this.settings.model)) {
                this.settings.model = this.models[0].id;
            }
        } catch (error) {
            console.warn('NanoGPT TTS models fetch failed', error);
            this.models = [];
        }
    }

    populateModelSelect() {
        const select = $('#nanogpt_tts_model');
        select.empty();

        if (!this.models.length) {
            select.append(new Option(this.settings.model, this.settings.model));
            return;
        }

        for (const model of this.models) {
            const label = model.name || model.id;
            const price = model.pricing?.per_thousand_chars;
            const text = price === undefined ? label : `${label} ($${price}/1k chars)`;
            select.append(new Option(text, model.id));
        }

        select.val(this.settings.model);
    }

    getModelVoices() {
        const model = this.models.find(model => model.id === this.settings.model);
        const voices = model?.supported_parameters?.voices;
        const fallbackVoices = ['alloy', 'ash', 'ballad', 'coral', 'echo', 'fable', 'onyx', 'nova', 'sage', 'shimmer', 'verse'];

        if (!Array.isArray(voices) || voices.length === 0) {
            return fallbackVoices.map(voice => ({ name: voice, voice_id: voice, lang: 'en-US' }));
        }

        return voices
            .map(voice => {
                if (typeof voice === 'string') {
                    return { name: voice, voice_id: voice, lang: 'en-US' };
                }

                if (voice && typeof voice === 'object') {
                    const voiceId = voice.voice_id || voice.id || voice.name;
                    if (!voiceId) {
                        return null;
                    }

                    return {
                        name: voice.name || voiceId,
                        voice_id: voiceId,
                        lang: voice.lang || voice.language || 'en-US',
                        preview_url: voice.preview_url || false,
                    };
                }

                return null;
            })
            .filter(Boolean);
    }

    async getVoice(voiceName) {
        if (this.voices.length === 0) {
            this.voices = await this.fetchTtsVoiceObjects();
        }

        const voice = this.voices.find(voice => voice.name === voiceName || voice.voice_id === voiceName);
        if (!voice) {
            throw `TTS Voice name ${voiceName} not found`;
        }

        return voice;
    }

    async generateTts(text, voiceId) {
        return this.fetchTtsGeneration(text, voiceId);
    }

    async fetchTtsVoiceObjects() {
        return this.getModelVoices();
    }

    async previewTtsVoice(voiceId) {
        this.audioElement.pause();
        this.audioElement.currentTime = 0;

        const response = await this.fetchTtsGeneration(getPreviewString('en-US'), voiceId);
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
        }

        const audio = await response.blob();
        const url = URL.createObjectURL(audio);
        this.audioElement.src = url;
        this.audioElement.play();
        this.audioElement.onended = () => URL.revokeObjectURL(url);
    }

    async fetchTtsGeneration(inputText, voiceId) {
        console.info(`Generating NanoGPT TTS for voice_id ${voiceId}`);

        const body = {
            input: inputText,
            model: this.settings.model,
            voice: voiceId,
            response_format: this.settings.response_format,
            speed: this.settings.speed,
        };

        if (this.settings.instructions?.trim()) {
            body.instructions = substituteParams(this.settings.instructions.trim());
        }

        const response = await fetch('/api/speech/nanogpt/synthesize', {
            method: 'POST',
            headers: getRequestHeaders(),
            body: JSON.stringify(body),
        });

        if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${await response.text()}`);
        }

        return response;
    }
}

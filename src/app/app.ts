import { Component, signal, NgZone } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ChatService } from './chat.service';

interface Message {
  sender: 'user' | 'bot';
  text: string;
}

interface ChatSession {
  id: string;
  title: string;
  date: Date;
  messages: Message[];
}

declare global {
  interface Window {
    SpeechRecognition: any;
    webkitSpeechRecognition: any;
  }
}

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './app.html',
  styleUrl: './app.css'
})
export class App {
  sessions = signal<ChatSession[]>([]);
  activeSessionId = signal<string>('');
  
  messages = signal<Message[]>([]);
  showWelcomeScreen = signal<boolean>(true);
  welcomeStep = signal<number>(1);
  
  teacherName = '';
  sidebarOpen = signal<boolean>(false);
  newMessage = '';
  loading = signal<boolean>(false);
  isListening = signal<boolean>(false);
  ttsEnabled = signal<boolean>(true);
  isSpeaking = signal<boolean>(false);

  availableVoices = signal<SpeechSynthesisVoice[]>([]);
  selectedVoiceIndex = signal<number>(0);
  private recognition: any = null;

  quickQuestions = [
    '¿Qué actividades debo realizar en la Semana 1?',
    '¿Cuándo se suben las notas de la primera evaluación continua?',
    '¿Qué debo revisar entre las Semanas 1 a 4?',
    '¿Qué se evalúa en la Semana 5 de Evaluación Parcial?'
  ];

  constructor(private chatService: ChatService, private ngZone: NgZone) {
    const savedName = localStorage.getItem('ucssito_teacher_name');
    if (savedName) {
      this.teacherName = savedName;
    }
    this.initSpeechRecognition();
    this.loadVoices();
    this.loadChatHistory();
  }

  toggleSidebar() {
    this.sidebarOpen.update(val => !val);
  }

  private loadChatHistory() {
    try {
      const saved = localStorage.getItem('ucssito_chat_sessions');
      const savedName = localStorage.getItem('ucssito_teacher_name');
      
      // If user has already entered their name previously, keep them logged in automatically!
      if (savedName && savedName.trim().length > 0) {
        this.teacherName = savedName;
        this.showWelcomeScreen.set(false);
      } else {
        this.showWelcomeScreen.set(true);
      }

      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed) && parsed.length > 0) {
          this.sessions.set(parsed);
          this.activeSessionId.set(parsed[0].id);
          this.messages.set(parsed[0].messages);
          return;
        }
      }
    } catch (e) {
      console.error('Error cargando historial:', e);
    }

    this.createNewSession();
  }

  private saveChatHistory() {
    try {
      localStorage.setItem('ucssito_chat_sessions', JSON.stringify(this.sessions()));
    } catch (e) {
      console.error('Error guardando historial:', e);
    }
  }

  private getGreetingText(): string {
    const name = this.teacherName.trim();
    if (!name) return '¡Hola estimado docente! Soy UCSSito. ¿En qué te puedo ayudar hoy con tus actividades académicas?';

    const capitalizedName = name.split(' ').map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(' ');
    return `¡Hola estimado docente ${capitalizedName}! Soy UCSSito. ¿En qué te puedo ayudar hoy con tus actividades académicas?`;
  }

  createNewSession() {
    // Clean up any empty sessions without user interaction
    const activeSessions = this.sessions().filter(s => s.messages.some((m: Message) => m.sender === 'user'));
    
    // Check if current active session is empty, re-use it if possible
    const currentActive = this.sessions().find(s => s.id === this.activeSessionId());
    if (currentActive && !currentActive.messages.some((m: Message) => m.sender === 'user')) {
      this.showWelcomeScreen.set(false);
      this.sidebarOpen.set(false);
      return;
    }

    const newId = 'session_' + Date.now();
    const initialMessages: Message[] = [
      { sender: 'bot', text: this.getGreetingText() }
    ];
    const newSession: ChatSession = {
      id: newId,
      title: 'Nuevo Chat',
      date: new Date(),
      messages: initialMessages
    };

    this.sessions.set([newSession, ...activeSessions]);
    this.activeSessionId.set(newId);
    this.messages.set(initialMessages);
    this.showWelcomeScreen.set(false);
    this.saveChatHistory();
    this.sidebarOpen.set(false);
  }

  selectSession(session: ChatSession) {
    this.activeSessionId.set(session.id);
    this.messages.set(session.messages);
    this.showWelcomeScreen.set(false);
    this.sidebarOpen.set(false);
  }

  // Modal de confirmación personalizado integrado en la aplicación
  confirmModalOpen = signal<boolean>(false);
  confirmModalMessage = signal<string>('');
  private pendingConfirmAction: (() => void) | null = null;

  openConfirmModal(message: string, action: () => void) {
    this.confirmModalMessage.set(message);
    this.pendingConfirmAction = action;
    this.confirmModalOpen.set(true);
  }

  cancelConfirm() {
    this.confirmModalOpen.set(false);
    this.pendingConfirmAction = null;
  }

  acceptConfirm() {
    this.confirmModalOpen.set(false);
    if (this.pendingConfirmAction) {
      this.pendingConfirmAction();
      this.pendingConfirmAction = null;
    }
  }

  deleteSession(sessionId: string, event: Event) {
    event.stopPropagation();
    this.openConfirmModal('¿Estás seguro de que deseas eliminar esta conversación?', () => {
      const updated = this.sessions().filter(s => s.id !== sessionId);
      this.sessions.set(updated);

      if (updated.length > 0) {
        if (this.activeSessionId() === sessionId) {
          const nextSession = updated[0];
          this.activeSessionId.set(nextSession.id);
          this.messages.set(nextSession.messages);
          this.showWelcomeScreen.set(false);
        }
      } else {
        this.createNewSession();
        // Ensure sidebar stays open after reset
        this.sidebarOpen.set(true);
      }
      this.saveChatHistory();
    });
  }

  clearAllHistory() {
    this.openConfirmModal('¿Estás seguro de que deseas eliminar TODO el historial de conversaciones? Esta acción no se puede deshacer.', () => {
      this.sessions.set([]);
      this.createNewSession();
      this.sidebarOpen.set(true);
      this.saveChatHistory();
    });
  }

  sendQuickQuestion(question: string) {
    this.newMessage = question;
    this.sendMessage();
  }

  goToNameStep() {
    this.welcomeStep.set(2);
  }

  changeUser() {
    this.openConfirmModal('¿Deseas cerrar sesión o cambiar de nombre de docente?', () => {
      this.teacherName = '';
      localStorage.removeItem('ucssito_teacher_name');
      this.welcomeStep.set(2);
      this.showWelcomeScreen.set(true);
      this.sidebarOpen.set(false);
    });
  }

  startChatting() {
    if (this.teacherName.trim()) {
      localStorage.setItem('ucssito_teacher_name', this.teacherName.trim());
    }
    this.showWelcomeScreen.set(false);
    // Reset initial message with personalized greeting
    const greeting = this.getGreetingText();
    const activeId = this.activeSessionId();
    if (activeId) {
      this.messages.set([{ sender: 'bot', text: greeting }]);
      this.sessions.update(list => list.map(s => {
        if (s.id === activeId) {
          return { ...s, messages: [{ sender: 'bot', text: greeting }] };
        }
        return s;
      }));
      this.saveChatHistory();
    }
  }

  private initSpeechRecognition() {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (SpeechRecognition) {
      this.recognition = new SpeechRecognition();
      this.recognition.lang = 'es-PE';
      this.recognition.continuous = false;
      this.recognition.interimResults = false;

      this.recognition.onresult = (event: any) => {
        const transcript = event.results[0][0].transcript;
        this.ngZone.run(() => {
          this.newMessage = transcript;
          this.isListening.set(false);
          this.sendMessage();
        });
      };

      this.recognition.onerror = (event: any) => {
        console.error('Error de reconocimiento de voz:', event.error);
        this.ngZone.run(() => {
          this.isListening.set(false);
        });
      };

      this.recognition.onend = () => {
        this.ngZone.run(() => {
          this.isListening.set(false);
        });
      };
    }
  }

  toggleListening() {
    if (!this.recognition) {
      alert('Tu navegador no soporta el reconocimiento de voz. Te recomendamos usar Google Chrome o Edge.');
      return;
    }

    if (this.isListening()) {
      this.recognition.stop();
      this.isListening.set(false);
    } else {
      if (this.isSpeaking()) {
        window.speechSynthesis.cancel();
        this.isSpeaking.set(false);
      }
      try {
        this.recognition.start();
        this.isListening.set(true);
      } catch (err) {
        console.error('Error al iniciar micrófono:', err);
        this.isListening.set(false);
      }
    }
  }

  toggleTts() {
    this.ttsEnabled.update(val => !val);
    if (!this.ttsEnabled() && this.isSpeaking()) {
      window.speechSynthesis.cancel();
      this.isSpeaking.set(false);
    }
  }

  private loadVoices() {
    if (!('speechSynthesis' in window)) return;

    const updateVoices = () => {
      const allVoices = window.speechSynthesis.getVoices();
      const spanishVoices = allVoices.filter(v => v.lang.toLowerCase().includes('es'));
      
      this.ngZone.run(() => {
        this.availableVoices.set(spanishVoices.length > 0 ? spanishVoices : allVoices);
        const femaleKeywords = ['sabina', 'paulina', 'monica', 'mónica', 'paloma', 'dalia', 'helena', 'laura', 'lucia', 'hilda', 'zira', 'mia', 'soledad', 'victoria', 'female', 'muj', 'salma'];
        const femaleIdx = (spanishVoices.length > 0 ? spanishVoices : allVoices).findIndex(v => 
          femaleKeywords.some(kw => v.name.toLowerCase().includes(kw))
        );
        if (femaleIdx !== -1) {
          this.selectedVoiceIndex.set(femaleIdx);
        }
      });
    };

    updateVoices();
    if (window.speechSynthesis.onvoiceschanged !== undefined) {
      window.speechSynthesis.onvoiceschanged = updateVoices;
    }
  }

  speakText(text: string) {
    if (!('speechSynthesis' in window) || !this.ttsEnabled()) return;

    window.speechSynthesis.cancel();
    
    const cleanText = text
      .replace(/UCSSito/gi, 'Ucsito')
      .replace(/UCSS/gi, 'Ucs')
      .replace(/\*+/g, '')
      .replace(/#+/g, '')
      .replace(/`/g, '')
      .replace(/\[(.*?)\]\(.*?\)/g, '$1');

    const utterance = new SpeechSynthesisUtterance(cleanText);
    utterance.rate = 1.3;
    utterance.pitch = 1.1;

    const voices = this.availableVoices();
    if (voices.length > 0 && voices[this.selectedVoiceIndex()]) {
      utterance.voice = voices[this.selectedVoiceIndex()];
    }

    utterance.onstart = () => {
      this.ngZone.run(() => this.isSpeaking.set(true));
    };

    utterance.onend = () => {
      this.ngZone.run(() => this.isSpeaking.set(false));
    };

    utterance.onerror = () => {
      this.ngZone.run(() => this.isSpeaking.set(false));
    };

    window.speechSynthesis.speak(utterance);
  }

  formatMessage(text: string): string {
    if (!text) return '';
    return text
      .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
      .replace(/\*(.*?)\*/g, '<em>$1</em>')
      .replace(/\n/g, '<br/>')
      .trim();
  }

  sendMessage() {
    const text = this.newMessage.trim();
    if (!text || this.loading()) return;

    this.showWelcomeScreen.set(false);

    if (this.isSpeaking()) {
      window.speechSynthesis.cancel();
      this.isSpeaking.set(false);
    }

    const userMsg: Message = { sender: 'user', text };
    const currentMsgs = [...this.messages(), userMsg];
    this.messages.set(currentMsgs);
    this.newMessage = '';
    this.loading.set(true);

    const activeId = this.activeSessionId();
    this.sessions.update(list => list.map(s => {
      if (s.id === activeId) {
        const title = (s.title === 'Nueva consulta' || s.title === 'Nuevo Chat') ? text.slice(0, 26) + (text.length > 26 ? '...' : '') : s.title;
        return { ...s, title, messages: currentMsgs };
      }
      return s;
    }));
    this.saveChatHistory();

    // Send history of conversation to maintain context, excluding initial greeting and system errors
    const historyPayload = currentMsgs
      .filter(m => !m.text.includes('Lo siento, ocurrió un error'))
      .map(m => ({ role: m.sender === 'user' ? 'user' : 'model', text: m.text }));

    this.chatService.sendMessage(text, historyPayload).subscribe({
      next: (res) => {
        const botMsg: Message = { sender: 'bot', text: res.response };
        this.messages.update(msgs => [...msgs, botMsg]);
        this.loading.set(false);

        this.sessions.update(list => list.map(s => {
          if (s.id === activeId) {
            return { ...s, messages: [...s.messages, botMsg] };
          }
          return s;
        }));
        this.saveChatHistory();

        this.speakText(res.response);
      },
      error: (err) => {
        console.error('Error al conectar con UCSSito Backend:', err);
        const errorMsg = 'Lo siento, ocurrió un error al comunicarme con el servidor Backend.';
        const botMsg: Message = { sender: 'bot', text: errorMsg };
        this.messages.update(msgs => [...msgs, botMsg]);
        this.loading.set(false);
        this.speakText(errorMsg);
      }
    });
  }
}

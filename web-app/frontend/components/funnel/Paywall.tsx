import React from 'react';
import { CheckCircleIcon } from './IconComponents';

interface PaywallProps {
  onStartPaid: () => void;
  onStartDemo: () => void;
  isDemoCompleted: boolean;
}

const Paywall: React.FC<PaywallProps> = ({ onStartPaid, onStartDemo, isDemoCompleted }) => {
  const benefits = ['Без оценок', 'Без стыда', 'Удобно в любое время', 'Практика голосом'];
  return (
    <div className="flex items-center justify-center min-h-screen bg-gray-900 text-white p-4 relative overflow-hidden">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,_rgba(139,92,246,0.15)_0%,_rgba(139,92,246,0)_50%)]"></div>
      <div className="w-full max-w-md mx-auto bg-gray-800/40 backdrop-blur-lg border border-gray-700 rounded-2xl shadow-2xl overflow-hidden z-10">
        <div className="p-8">
          <h1 className="text-3xl md:text-4xl font-bold text-center mb-4">
            Говорите по-английски без страха
          </h1>
          <p className="text-center text-lg text-gray-300 mb-8">Ежедневно, по 10 минут</p>

          <div className="bg-cyan-600 text-center p-6 rounded-xl my-6">
            <p className="text-4xl font-extrabold">1590 ₽</p>
            <p className="font-medium text-cyan-200">за 30 дней практики</p>
          </div>

          <div className="text-center bg-gray-700/40 p-4 rounded-lg border border-gray-600 mb-8">
            <p className="text-sm">
              <span className="font-semibold">Сравните:</span> 1 урок у репетитора = 2000-3000 ₽. <br/> У нас — целый месяц безлимитных диалогов.
            </p>
          </div>

          <ul className="space-y-3 mb-10">
            {benefits.map(benefit => (
              <li key={benefit} className="flex items-center">
                <CheckCircleIcon className="h-6 w-6 text-green-400 mr-3 flex-shrink-0" />
                <span className="text-gray-200">{benefit}</span>
              </li>
            ))}
          </ul>
          
          <div className="flex flex-col gap-4">
            <button
              onClick={onStartPaid}
              className="w-full bg-cyan-600 text-white font-bold py-4 px-4 rounded-xl shadow-lg hover:bg-cyan-700 focus:outline-none focus:ring-4 focus:ring-cyan-500/50 transition-all duration-300 transform hover:scale-105"
            >
              Начать за 1590 ₽
            </button>
            <button
              onClick={onStartDemo}
              disabled={isDemoCompleted}
              className="w-full bg-transparent border-2 border-gray-600 text-gray-300 font-semibold py-3 px-4 rounded-xl hover:bg-gray-700 hover:border-gray-500 focus:outline-none focus:ring-4 focus:ring-gray-600/50 transition-colors duration-300 disabled:opacity-60 disabled:cursor-not-allowed disabled:bg-gray-700/50 disabled:border-gray-700 disabled:hover:bg-gray-700/50"
            >
              {isDemoCompleted ? 'Вы уже прошли демо' : 'Демо 5 минут'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default Paywall;

import React from 'react';
import { Scenario } from '../types';

interface Props {
    scenarios: Scenario[];
    onSelectScenario: (scenario: Scenario) => void;
}

const ScenarioSelectionScreen: React.FC<Props> = ({ scenarios, onSelectScenario }) => {
    return (
        <div className="p-4 md:p-8">
            <h2 className="text-3xl font-bold text-center text-white mb-2">Choose a Scenario</h2>
            <p className="text-center text-gray-400 mb-8">Select a topic to start your practice session.</p>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 max-w-5xl mx-auto">
                {scenarios.map(scenario => (
                    <button
                        key={scenario.title}
                        onClick={() => onSelectScenario(scenario)}
                        className="bg-gray-800 p-6 rounded-lg border border-gray-700 text-left hover:bg-gray-700 hover:border-cyan-500 transition-all duration-200 focus:outline-none focus:ring-2 focus:ring-cyan-500"
                    >
                        <h3 className="text-xl font-semibold text-white mb-2">{scenario.title}</h3>
                        <p className="text-gray-400">{scenario.description}</p>
                    </button>
                ))}
            </div>
        </div>
    );
};

export default ScenarioSelectionScreen;

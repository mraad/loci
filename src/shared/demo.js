import {parseNote} from './knowledge.js';
const entries=[
['Designing for a quiet mind','design','Good design makes room for thought. The most useful interfaces don’t compete for our attention — they help us direct it.\n\n## A little less, a little better\nA quiet interface reveals only what matters in the moment. Space, rhythm, and a considered hierarchy let the content breathe.\n\nThe goal is not minimalism for its own sake. It is clarity. Every element should earn its place.\n\n“Attention is the beginning of devotion.” — Mary Oliver\n\n## Connections worth following\nHow might [[The garden and the stream]] change the way we design tools for thinking? There’s a connection to [[A room for deep work]], too.'],
['The shape of good tools','design','A tool should feel like an extension of your thinking. Design is the balance between affordance, feedback and restraint. [[Designing for a quiet mind]]'],
['Less, but better','design','Dieter Rams and the enduring principles of design. Simplicity creates space for meaningful things. https://www.vitsoe.com/us/about/good-design'],
['A pattern language','design','Patterns connect the design of rooms, cities and interfaces. Christopher Alexander describes places that make us feel alive. [[The shape of good tools]]'],
['Interfaces as places','design','What if software felt like a familiar place? Spatial memory and gentle landmarks make interfaces easier to navigate.'],
['The garden and the stream','nature','A garden is knowledge tended over time. A stream is the passing flow of information. Both are useful, but a garden gives thoughts roots.\n\n## A living collection\nLet ideas grow. Connect the paths. Return to a note and see it differently. [[Learning in spirals]]'],
['What trees can teach us','nature','Forests are connected networks. Roots and fungi exchange nutrients. Knowledge grows in a similar way: through relationships, not isolation.'],
['Walking as a way of thinking','nature','A walk creates room for a thought. Nature, movement and unstructured attention make new connections possible. [[A field guide to noticing]]'],
['A field guide to noticing','nature','Look closer. Observe the light, the leaves, the pattern in a stone. Attention is a practice of returning to the natural world.'],
['Biomimicry: learning from life','nature','Design inspired by the natural world: branching, growth, adaptation, resilience. https://biomimicry.org/'],
['Learning in spirals','learning','Learning is not a straight line. We return to an idea with more context and see something we missed.\n\n## Return with curiosity\nA note is a starting point for thought, not a finished destination. [[The garden and the stream]]'],
['How we remember places','learning','Spatial memory helps us remember locations and landmarks. The method of loci ties abstract ideas to familiar places. [[Interfaces as places]]'],
['The art of asking questions','learning','Learning begins with a question. Explore what you do not understand and connect new knowledge to what you already know.'],
['Make it stick','learning','Retrieval, spacing and interleaving help us learn. Returning to forgotten knowledge is as important as collecting it. https://www.retrievalpractice.org/'],
['Thinking in systems','learning','Feedback loops, emergence and relationships. A system is more than its individual parts. [[How we remember places]]'],
['Small software, big possibilities','technology','Software can be small, local and personal. Native webviews and embedded databases let tools stay fast and private. [[Local-first software]]'],
['Local-first software','technology','Own your data. Offline storage, embedded SQLite databases, and simple exports make software resilient. https://www.inkandswitch.com/local-first/'],
['A web of linked thoughts','technology','Graph structures connect notes through explicit links and shared concepts. A knowledge graph makes relationships visible. [[Thinking in systems]]'],
['WebGPU field notes','technology','GPU rendering turns a height field into a responsive landscape. WebGPU, WebGL and shaders give us new ways to explore data.'],
['Creative work needs empty space','creativity','Creativity happens between things. Leave time for wandering, sketching, and connecting ideas. [[Designing for a quiet mind]]'],
['Collecting sparks','creativity','Save an unexpected idea. Capture the fragment before it disappears. Creative inspiration is a conversation between your past and present self.'],
['Everything is a remix','creativity','Creative work recombines what already exists. New connections between distant ideas are the beginning of something original. https://www.youtube.com/watch?v=MZ2GuvUWaP8'],
['A room for deep work','living','Create a ritual around focused work. A clear desk, a quiet room and one meaningful task. [[Designing for a quiet mind]]'],
['A slower kind of productivity','living','Do fewer things with more care. Productivity is not a measure of how busy life feels. Make room for reflection and rest.'],
['The weekly wander','living','Take a little time each week to wander through old notes. Revisit the ideas you saved and notice the connections you missed. [[The garden and the stream]]']
];
export const demoNotes=entries.map(([title,tag,body],i)=>({...parseNote('# '+title+'\n\n'+body+'\n\n#'+tag,'Welcome/'+title+'.md',Date.now()-(i+2)*86400000),starred:[0,5,10,15].includes(i),demo:true}));

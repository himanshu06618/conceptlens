import os
import pymupdf as fitz
from PIL import Image, ImageDraw, ImageFont

def generate_pdf():
    pdf_path = "samples/biology_cell_structure.pdf"
    doc = fitz.open()

    # Page 1: Cellular Organization & Energy
    page1 = doc.new_page(width=595, height=842) # A4
    text_p1 = """Cell Biology & Bioenergetics - Lecture Notes (Module 3)

Chapter 1: Eukaryotic Cell Architecture

The eukaryotic cell is defined as a complex structural unit bounded by a plasma membrane containing membrane-bound organelles and a distinct nucleus.
Unlike prokaryotes, eukaryotic cells maintain compartmentalized biochemical microenvironments.

The nucleus refers to the membrane-enclosed organelle that houses the genetic material in the form of linear DNA and coordinates cell activities such as growth, metabolism, and protein synthesis.
Chromatin is defined as the complex of genomic DNA and histone proteins that packages genetic material inside the nuclear envelope.
The nucleolus represents the dense subnuclear region responsible for ribosomal RNA transcription and ribosome subunit assembly.

Chapter 2: Organelles and Cellular Energetics

Mitochondria are defined as double-membraned eukaryotic organelles that generate the majority of cellular adenosine triphosphate through oxidative phosphorylation.
Often referred to as the powerhouses of the cell, mitochondria possess their own circular mitochondrial DNA and ribosomes.
The mitochondrial matrix is the internal fluid compartment containing metabolic enzymes for the tricarboxylic acid cycle.

Cellular respiration refers to the metabolic pathway that breaks down glucose molecules to produce ATP in the presence of oxygen.
Glycolysis is defined as the initial anaerobic enzymatic sequence occurring in the cytosol that converts one glucose molecule into two molecules of pyruvate.
ATP synthase is the transmembrane enzyme complex that harnesses the proton electrochemical gradient across the inner mitochondrial membrane to synthesize adenosine triphosphate.
"""
    rect1 = fitz.Rect(50, 50, 545, 792)
    page1.insert_textbox(rect1, text_p1, fontsize=11, fontname="helv")

    # Page 2: Protein Synthesis and Secretion
    page2 = doc.new_page(width=595, height=842)
    text_p2 = """Cell Biology & Bioenergetics - Lecture Notes (Module 3) - Page 2

Chapter 3: The Endomembrane System

The endoplasmic reticulum is defined as an extensive interconnected network of tubular membranes and flattened cisternae continuous with the outer nuclear membrane.
Rough endoplasmic reticulum is studded with ribosomes and specializes in protein synthesis and folding for secretable proteins.
Smooth endoplasmic reticulum refers to the tubular agranular membrane network dedicated to lipid synthesis, carbohydrate metabolism, and calcium ion sequestration.

Ribosomes are defined as macromolecular ribonucleoprotein complexes that catalyze the translation of messenger RNA into polypeptide chains.
Each functional ribosome consists of a small subunit that decodes mRNA and a large subunit that forms peptide bonds.

The Golgi apparatus refers to the eukaryotic organelle composed of polar cisternae that modifies, sorts, and packages glycoproteins and lipids for secretion or delivery to lysosomes.
Lysosomes are defined as acidic, membrane-delimited digestive vesicles containing hydrolytic enzymes capable of degrading macromolecules and cellular debris.
Autophagy is the catabolic cellular process whereby damaged organelles are degraded within autophagosomes fused to lysosomes.
"""
    rect2 = fitz.Rect(50, 50, 545, 792)
    page2.insert_textbox(rect2, text_p2, fontsize=11, fontname="helv")

    doc.save(pdf_path)
    doc.close()
    print(f"Generated text PDF: {pdf_path}")

def generate_scanned_image():
    img_path = "samples/scanned_notes_neural_networks.png"
    # Create white canvas 1400 x 1800
    w, h = 1400, 1800
    img = Image.new("RGB", (w, h), color=(250, 250, 250))
    draw = ImageDraw.Draw(img)

    # Draw simulated paper margin
    draw.line([(120, 0), (120, h)], fill=(230, 200, 200), width=2)
    draw.line([(0, 180), (w, 180)], fill=(210, 210, 230), width=2)

    # Draw text lines
    lines = [
        ("CS 701: Deep Learning Foundations", 28, (20, 20, 60)),
        ("Lecture 4: Neural Networks and Backpropagation", 22, (50, 50, 50)),
        ("", 16, (0, 0, 0)),
        ("1. Artificial Neural Networks", 22, (20, 20, 20)),
        ("An artificial neural network is defined as a computational learning model", 18, (30, 30, 30)),
        ("inspired by biological neural networks, consisting of interconnected artificial neurons.", 18, (30, 30, 30)),
        ("Each connection carries a real-valued weight adjusted during training.", 18, (30, 30, 30)),
        ("", 16, (0, 0, 0)),
        ("2. Activation Function", 22, (20, 20, 20)),
        ("An activation function is defined as a mathematical equation determining the output", 18, (30, 30, 30)),
        ("of a neural node based on its weighted input sum.", 18, (30, 30, 30)),
        ("Common activation functions include ReLU, Sigmoid, and Leaky ReLU.", 18, (30, 30, 30)),
        ("ReLU refers to the rectified linear activation function defined as f(x) = max(0, x).", 18, (30, 30, 30)),
        ("", 16, (0, 0, 0)),
        ("3. Backpropagation and Optimization", 22, (20, 20, 20)),
        ("Backpropagation is defined as the algorithm used to calculate the gradient of the loss", 18, (30, 30, 30)),
        ("function with respect to each weight using the chain rule of calculus.", 18, (30, 30, 30)),
        ("Gradient descent refers to the iterative first-order optimization algorithm", 18, (30, 30, 30)),
        ("used to minimize the cost function by adjusting model parameters.", 18, (30, 30, 30)),
        ("The learning rate is a hyperparameter that controls the step size taken in parameter space.", 18, (30, 30, 30)),
        ("", 16, (0, 0, 0)),
        ("4. Loss Function and Regularization", 22, (20, 20, 20)),
        ("A loss function is defined as a mathematical function that quantifies the error", 18, (30, 30, 30)),
        ("between predicted model outputs and true ground-truth targets.", 18, (30, 30, 30)),
        ("Overfitting refers to the phenomenon where a model memorizes training noise", 18, (30, 30, 30)),
        ("and fails to generalize effectively to unseen test data.", 18, (30, 30, 30)),
        ("Regularization is a technique used to penalize complex weights to prevent overfitting.", 18, (30, 30, 30)),
        ("Dropout refers to a regularization method that randomly deactivates neurons during training.", 18, (30, 30, 30)),
    ]

    y_pos = 120
    for text, size, color in lines:
        if text:
            draw.text((150, y_pos), text, fill=color)
        y_pos += 45

    # Save image
    img.save(img_path)
    print(f"Generated scanned image: {img_path}")

if __name__ == "__main__":
    generate_pdf()
    generate_scanned_image()

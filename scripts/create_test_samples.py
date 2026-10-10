#!/usr/bin/env python3
"""
scripts/create_test_samples.py
Generates the comprehensive suite of test sample PDFs:
- sample_text.pdf: Normal multi-page text PDF
- sample_text_50p.pdf: Text PDF with 52 pages (for 50+ page timing test)
- sample_scanned.pdf: Scanned / image-only PDF with 12 pages (for 10+ page timing test)
- sample_slides.pdf: Slides-style PDF (16:9 landscape) with text rendered inside images
- sample_broken_font.pdf: PDF with broken font encoding / (cid:xx) markers
- sample_encrypted.pdf: Password-protected PDF (password: "secret123")
- sample_mixed.pdf: Mixed PDF with alternating text and scanned pages
"""

import os
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont
import pymupdf as fitz

SAMPLES_DIR = Path(__file__).resolve().parent.parent / "samples"
SAMPLES_DIR.mkdir(parents=True, exist_ok=True)


def create_sample_text():
    """Creates a normal 4-page text PDF."""
    path = SAMPLES_DIR / "sample_text.pdf"
    doc = fitz.open()

    topics = [
        ("Database Systems: Relational Model",
         "The relational database model organizes data into one or more tables (or relations) of columns and rows, with a unique key identifying each row. Relational algebra provides the formal theoretical foundation for relational databases and SQL queries. A primary key uniquely identifies each record in a relational table, ensuring entity integrity."),
        ("Transactions and ACID Properties",
         "A database transaction symbolizes a unit of work performed within a database management system. Transactions must satisfy the ACID properties: Atomicity, Consistency, Isolation, and Durability. Atomicity guarantees that all transactions execute completely or not at all."),
        ("Indexing and B-Trees",
         "A database index is a data structure that improves the speed of data retrieval operations on a database table. B-Trees and B+ Trees are self-balancing search trees widely used in relational database storage engines for range queries and fast lookups."),
        ("Concurrency Control: Two-Phase Locking",
         "Two-Phase Locking (2PL) is a concurrency control method that guarantees serializability. In the growing phase, locks are acquired and no locks are released. In the shrinking phase, locks are released and no new locks can be acquired.")
    ]

    for title, body in topics:
        page = doc.new_page(width=595, height=842)  # A4
        # Add heading
        page.insert_text(fitz.Point(50, 80), title, fontsize=16, fontname="helv", color=(0.1, 0.2, 0.4))
        # Add paragraphs
        rect = fitz.Rect(50, 120, 545, 780)
        page.insert_textbox(rect, f"{body}\n\nKey Concepts:\n- Concept Definitions\n- Implementation Details\n- Performance Considerations\n\nStudy Notes for Computer Science 301.", fontsize=11, fontname="helv")

    doc.save(str(path))
    doc.close()
    print(f"Generated: {path.name}")


def create_sample_text_50p():
    """Creates a 52-page text PDF for benchmark timing tests."""
    path = SAMPLES_DIR / "sample_text_50p.pdf"
    doc = fitz.open()

    base_topics = [
        "Computational Thinking and Algorithms",
        "Algorithmic Decomposition and Problem Formulation",
        "Pattern Recognition in Large Datasets",
        "Abstraction and Mathematical Modeling",
        "Sorting Algorithms: QuickSort, MergeSort, HeapSort",
        "Graph Theory: Dijkstra, Breadth-First Search, Depth-First Search",
        "Dynamic Programming and Memoization Techniques",
        "Greedy Algorithms and Huffman Coding"
    ]

    for i in range(52):
        topic = base_topics[i % len(base_topics)]
        page = doc.new_page(width=595, height=842)
        title = f"Chapter {i+1}: {topic}"
        page.insert_text(fitz.Point(50, 70), title, fontsize=15, fontname="helv", color=(0.1, 0.2, 0.4))
        content = (
            f"This chapter explores {topic} in depth. In computational science, "
            f"structured reasoning allows developers to systematically solve complex engineering challenges.\n\n"
            f"Definition {i+1}.1: {topic} is defined as a systematic process for optimizing computational complexity.\n"
            f"Key property: The asymptotic runtime complexity is bounded by O(n log n) under standard assumptions.\n"
            f"Applications include distributed systems, database query planning, and machine learning pipelines.\n\n"
            f"Section {i+1}.2 Analysis:\n"
            f"When evaluating {topic}, practitioners must consider memory hierarchy cache lines, "
            f"concurrency locks, and data structure invariants. Empirical benchmarks show consistent throughput.\n"
            f"Summary: Understanding {topic} provides the foundational theory for scalable computing."
        )
        rect = fitz.Rect(50, 110, 545, 780)
        page.insert_textbox(rect, content, fontsize=11, fontname="helv")

    doc.save(str(path))
    doc.close()
    print(f"Generated: {path.name}")


def create_image_page(text_content: str, width: int = 1200, height: int = 1600) -> bytes:
    """Renders text onto a PIL Image bitmap to simulate a scanned document."""
    img = Image.new("RGB", (width, height), color=(252, 252, 250))
    draw = ImageDraw.Draw(img)

    # Draw simulated paper lines and header
    draw.rectangle([50, 50, width - 50, height - 50], outline=(220, 220, 220), width=2)
    draw.text((80, 90), "LECTURE NOTES - SCANNED COPY", fill=(40, 40, 80))
    draw.line([80, 130, width - 80, 130], fill=(180, 180, 200), width=2)

    # Simple line-by-line drawing
    y = 170
    for line in text_content.split("\n"):
        if y > height - 100:
            break
        draw.text((80, y), line, fill=(20, 20, 20))
        y += 45

    import io
    buf = io.BytesIO()
    img.save(buf, format="JPEG", quality=85)
    return buf.getvalue()


def create_sample_scanned():
    """Creates a 12-page scanned image-only PDF with 0 text layer."""
    path = SAMPLES_DIR / "sample_scanned.pdf"
    doc = fitz.open()

    scanned_texts = [
        "Lecture 1: Introduction to Artificial Neural Networks\nAn artificial neural network (ANN) is a computational model inspired by biological neural networks.\nNeurons receive input signals, apply weights, add a bias term, and pass through an activation function.",
        "Lecture 2: Perceptron Model and Linear Separability\nThe perceptron is a binary classification algorithm invented by Frank Rosenblatt in 1957.\nIt computes a weighted sum of inputs and outputs 1 if the sum exceeds a threshold, otherwise 0.",
        "Lecture 3: Multilayer Perceptrons and Activation Functions\nMultilayer perceptrons (MLP) contain one or more hidden layers between the input and output layers.\nCommon activation functions include Sigmoid, Hyperbolic Tangent (Tanh), and Rectified Linear Unit (ReLU).",
        "Lecture 4: Backpropagation and Gradient Descent\nBackpropagation is an algorithm used to calculate the gradient of the loss function with respect to weights.\nGradient descent iteratively adjusts network weights in the direction of steepest descent to minimize loss.",
        "Lecture 5: Loss Functions and Optimization\nMean Squared Error (MSE) is commonly used for regression tasks.\nCross-Entropy Loss is the standard objective function for multi-class classification problems.",
        "Lecture 6: Overfitting and Regularization Techniques\nOverfitting occurs when a neural network models training noise rather than the underlying distribution.\nRegularization techniques include L1 (Lasso), L2 (Ridge / Weight Decay), and Dropout.",
        "Lecture 7: Convolutional Neural Networks (CNN)\nCNNs are specialized neural networks for processing grid-structured data such as images.\nCore operations include convolution filters, pooling layers (max pooling), and fully connected layers.",
        "Lecture 8: Recurrent Neural Networks (RNN)\nRNNs process sequential data by maintaining an internal hidden state across time steps.\nLong Short-Term Memory (LSTM) and Gated Recurrent Units (GRU) mitigate the vanishing gradient problem.",
        "Lecture 9: Attention Mechanisms and Transformers\nThe attention mechanism allows models to focus dynamically on different segments of input sequences.\nThe Transformer architecture relies entirely on self-attention mechanisms without recurrence.",
        "Lecture 10: Deep Learning Optimization and Schedulers\nAdaptive optimizers like Adam and RMSprop adjust learning rates per parameter.\nLearning rate warmup and cosine annealing schedules improve model generalization.",
        "Lecture 11: Autoencoders and Latent Representation\nAutoencoders are unsupervised neural networks designed to learn efficient codings of input data.\nThey consist of an encoder mapping input to code, and a decoder reconstructing input from code.",
        "Lecture 12: Generative Adversarial Networks (GAN)\nGANs consist of two competing networks: a generator synthesizing data and a discriminator evaluating realism.\nThey are trained simultaneously in a minimax game framework."
    ]

    for text in scanned_texts:
        img_bytes = create_image_page(text, width=1000, height=1400)
        page = doc.new_page(width=595, height=842)
        # Insert image covering the entire page
        rect = fitz.Rect(0, 0, 595, 842)
        page.insert_image(rect, stream=img_bytes)

    doc.save(str(path))
    doc.close()
    print(f"Generated: {path.name}")


def create_sample_slides():
    """Creates a 4-page slides-style PDF (16:9 landscape) where text is inside images."""
    path = SAMPLES_DIR / "sample_slides.pdf"
    doc = fitz.open()

    slides = [
        ("Module 1: Operating Systems Overview",
         "What is an Operating System?\n- Resource allocator: manages CPU, memory, I/O devices\n- Control program: manages execution of user programs\n- Kernel: the one program running at all times"),
        ("Module 2: Process Scheduling",
         "Process States:\n- Ready: waiting to be assigned to CPU\n- Running: instructions are being executed\n- Waiting: waiting for an I/O event to occur\n- Scheduling algorithms: FCFS, Round Robin, Priority"),
        ("Module 3: Memory Management & Paging",
         "Virtual Memory Concepts:\n- Logical address space mapped to physical address space\n- Pages and frames: fixed-size memory blocks\n- Page Table: translates logical page numbers to physical frames"),
        ("Module 4: Deadlocks and Synchronization",
         "Coffman Conditions for Deadlock:\n1. Mutual Exclusion\n2. Hold and Wait\n3. No Preemption\n4. Circular Wait\nBanker's Algorithm ensures deadlock avoidance.")
    ]

    for title, body in slides:
        # 16:9 slide image
        w, h = 1280, 720
        img = Image.new("RGB", (w, h), color=(240, 245, 250))
        draw = ImageDraw.Draw(img)
        # Draw slide header bar
        draw.rectangle([0, 0, w, 100], fill=(30, 50, 90))
        draw.text((60, 35), title, fill=(255, 255, 255))

        # Draw slide body
        y = 150
        for line in body.split("\n"):
            draw.text((80, y), line, fill=(30, 30, 40))
            y += 45

        import io
        buf = io.BytesIO()
        img.save(buf, format="PNG")

        # Create landscape page
        page = doc.new_page(width=842, height=474)  # ~16:9
        page.insert_image(fitz.Rect(0, 0, 842, 474), stream=buf.getvalue())

    doc.save(str(path))
    doc.close()
    print(f"Generated: {path.name}")


def create_sample_broken_font():
    """
    Creates a PDF with corrupted/unmapped font codes such as (cid:xx) markers in the text layer,
    while visually having readable text so that the per-page OCR fallback ladder successfully recovers it.
    """
    path = SAMPLES_DIR / "sample_broken_font.pdf"
    doc = fitz.open()

    content_pages = [
        ("Graph Algorithms & Data Structures",
         "A graph is a non-linear data structure consisting of vertices and edges.\n"
         "Breadth First Search (BFS) traverses the graph level by level using a queue.\n"
         "Depth First Search (DFS) traverses along each branch using recursion or a stack.\n"
         "Dijkstra algorithm computes shortest paths in weighted graphs with non-negative edge weights.\n"
         "Topological sorting orders vertices in a directed acyclic graph linearly."),
        ("Binary Search Trees and Balanced Trees",
         "A Binary Search Tree (BST) maintains the property that left children are smaller and right children larger.\n"
         "AVL Trees maintain balance with height difference between subtrees at most one.\n"
         "Red-Black Trees maintain balance through node color properties and tree rotations.\n"
         "Tree traversals include Inorder, Preorder, and Postorder sequences."),
        ("Dynamic Programming and Optimization",
         "Dynamic programming solves complex problems by breaking them into overlapping subproblems.\n"
         "Optimal substructure means optimal solution of the problem contains optimal solutions to subproblems.\n"
         "Memoization stores results of expensive function calls to avoid recomputation.\n"
         "Tabulation builds the solution iteratively from the bottom up.")
    ]

    for title, body in content_pages:
        # Create an image containing readable visual text
        w, h = 1200, 1600
        img = Image.new("RGB", (w, h), color=(255, 255, 255))
        draw = ImageDraw.Draw(img)
        draw.text((80, 80), title, fill=(20, 20, 20))
        y = 180
        for line in body.split("\n"):
            draw.text((80, y), line, fill=(40, 40, 40))
            y += 60

        import io
        buf = io.BytesIO()
        img.save(buf, format="PNG")

        page = doc.new_page(width=595, height=842)
        # 1. Insert visual text image
        page.insert_image(fitz.Rect(0, 0, 595, 842), stream=buf.getvalue())

        # 2. Insert corrupted/unmapped font codes in text layer
        broken_text = (
            "(cid:87)(cid:101)(cid:108)(cid:99)(cid:111)(cid:109)(cid:101) (cid:116)(cid:111) "
            "§§§§¶¶¶¶ (cid:65)(cid:108)(cid:103)(cid:111)(cid:114)(cid:105)(cid:116)(cid:104)(cid:109)(cid:115)\n"
            "\ufffd\ufffd\ufffd\ufffd\ufffd \ufffd\ufffd\ufffd \ufffd\ufffd\ufffd\ufffd\n"
            "#$%^&*!@~_+-= (cid:45)(cid:67)(cid:89) >>>>> <<<<<<\n"
            "(cid:12)(cid:13)(cid:14)(cid:15) \ufffd\ufffd\ufffd\ufffd (cid:99)(cid:98)(cid:97)"
        )
        page.insert_text(fitz.Point(50, 100), broken_text, fontsize=12)

    doc.save(str(path))
    doc.close()
    print(f"Generated: {path.name}")


def create_sample_encrypted():
    """Creates a password-protected PDF."""
    path = SAMPLES_DIR / "sample_encrypted.pdf"
    doc = fitz.open()

    page = doc.new_page(width=595, height=842)
    page.insert_text(fitz.Point(50, 100), "Confidential Machine Learning Research Notes", fontsize=16)
    page.insert_textbox(
        fitz.Rect(50, 130, 545, 400),
        "This document contains encrypted research notes regarding proprietary reinforcement learning algorithms. "
        "A valid password is required to decrypt and view this content."
    )

    # Save encrypted with user password "secret123"
    perm = fitz.PDF_PERM_ACCESSIBILITY | fitz.PDF_PERM_PRINT
    doc.save(str(path), encryption=fitz.PDF_ENCRYPT_AES_256, user_pw="secret123", permissions=perm)
    doc.close()
    print(f"Generated: {path.name}")


def create_sample_mixed():
    """Creates a mixed PDF: page 1 text, page 2 scanned image, page 3 text, page 4 scanned image."""
    path = SAMPLES_DIR / "sample_mixed.pdf"
    doc = fitz.open()

    # Page 1: Normal text
    p1 = doc.new_page(width=595, height=842)
    p1.insert_text(fitz.Point(50, 80), "Part I: Cloud Computing Fundamentals", fontsize=16, fontname="helv")
    p1.insert_textbox(
        fitz.Rect(50, 120, 545, 500),
        "Cloud computing is the on-demand delivery of IT resources over the Internet with pay-as-you-go pricing. "
        "Core service models include Infrastructure as a Service (IaaS), Platform as a Service (PaaS), "
        "and Software as a Service (SaaS). Virtualization enables multiple virtual machines to run on a physical server."
    )

    # Page 2: Scanned image (diagram/notes)
    img2 = create_image_page("Handwritten Diagram: Virtual Machine vs Container Architecture\nHypervisor Type 1 runs directly on hardware.\nContainers share the host kernel while providing process isolation.", 1000, 1400)
    p2 = doc.new_page(width=595, height=842)
    p2.insert_image(fitz.Rect(0, 0, 595, 842), stream=img2)

    # Page 3: Normal text
    p3 = doc.new_page(width=595, height=842)
    p3.insert_text(fitz.Point(50, 80), "Part II: Distributed Systems & Consensus", fontsize=16, fontname="helv")
    p3.insert_textbox(
        fitz.Rect(50, 120, 545, 500),
        "Consensus algorithms allow a collection of machines to work as a coherent group that can survive failures. "
        "The Raft consensus algorithm is designed to be easy to understand and decomposes consensus into leader election, "
        "log replication, and safety."
    )

    # Page 4: Scanned image
    img4 = create_image_page("Lecture Slide Note: CAP Theorem Tradeoffs\nConsistency, Availability, Partition Tolerance.\nIn the presence of a network partition, a distributed system must choose between Consistency and Availability.", 1000, 1400)
    p4 = doc.new_page(width=595, height=842)
    p4.insert_image(fitz.Rect(0, 0, 595, 842), stream=img4)

    doc.save(str(path))
    doc.close()
    print(f"Generated: {path.name}")


def main():
    print("Generating sample test PDFs...")
    create_sample_text()
    create_sample_text_50p()
    create_sample_scanned()
    create_sample_slides()
    create_sample_broken_font()
    create_sample_encrypted()
    create_sample_mixed()
    print("\nAll sample test PDFs generated successfully in samples/!")


if __name__ == "__main__":
    main()
